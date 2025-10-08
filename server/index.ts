import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import passport from "./auth";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { schedulerService } from "./services/scheduler";
import { ensureAdminUserExists } from "./init-admin";

const app = express();
const PgSession = connectPgSimple(session);

declare module 'http' {
  interface IncomingMessage {
    rawBody: unknown
  }
}
app.use(express.json({
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: false }));

// Configuration des sessions
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️ SESSION_SECRET non défini. Utilisation d\'une clé par défaut (NON SÉCURISÉ en production)');
}

// Déterminer si on utilise HTTPS basé sur APP_URL
const isHttps = process.env.APP_URL?.startsWith('https://') || false;

// Configuration du store de session pour production
const sessionStore = process.env.NODE_ENV === 'production' && process.env.DATABASE_URL
  ? new PgSession({
      pool: new pg.Pool({
        connectionString: process.env.DATABASE_URL,
      }),
      tableName: 'session',
      createTableIfMissing: true,
    })
  : undefined; // MemoryStore par défaut en dev

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isHttps,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  }
}));

// Initialisation de Passport
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      // Ne pas logger les 401 sur /api/auth/session (vérification normale de session)
      if (path === "/api/auth/session" && res.statusCode === 401) {
        return;
      }
      
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  // Initialiser l'utilisateur admin par défaut avant de démarrer le serveur
  await ensureAdminUserExists();
  
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // Démarrer le scheduler pour les publications programmées
    schedulerService.start();
  });
})();
