import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import crypto from "crypto";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import passport from "./auth";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { schedulerService } from "./services/scheduler";
import { ensureAdminUserExists } from "./init-admin";
import { startTokenCron } from "./cron";
import { migrate } from "./migrate";
import { jamendoService } from "./services/jamendo";
import { freeSoundService } from "./services/freesound";
import { ffmpegService } from "./services/ffmpeg";

const app = express();
const PgSession = connectPgSimple(session);

// Faire confiance au reverse proxy (nginx) pour X-Forwarded-For
// Nécessaire pour que express-rate-limit identifie correctement les IPs
app.set('trust proxy', 1);

// Headers de sécurité HTTP avec helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://graph.facebook.com", "https://openrouter.ai", "https://res.cloudinary.com", "https://freesound.org", "wss:", "ws:"],
      mediaSrc: ["'self'", "https://cdn.freesound.org", "https:", "data:"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// Rate limiting global - 100 requêtes par 15 minutes par IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting strict pour l'authentification - 5 tentatives par 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Trop de tentatives de connexion, réessayez dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', globalLimiter);
app.use('/api/auth/login', authLimiter);

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

// Validation renforcée du SESSION_SECRET
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('❌ SESSION_SECRET non défini en production. Arrêt du serveur.');
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.warn('⚠️ SESSION_SECRET non défini. Utilisation d\'une clé aléatoire pour le développement.');
}

// Générer un secret aléatoire pour le dev si non défini
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

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
  secret: sessionSecret,
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
  // Run database migration first
  await migrate();

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

  // Configurer le service Jamendo pour les Reels
  const jamendoClientId = process.env.JAMENDO_CLIENT_ID || '5b6bba49';
  jamendoService.configure(jamendoClientId);

  // Configurer le service FreeSound pour les Reels
  // 1. Essayer de charger depuis la DB (suppose un utilisateur admin ou premier utilisateur)
  // Note: Dans un contexte multi-utilisateur, cela devrait être fait par requête.
  // Pour l'instant, on charge la config du premier user trouvé ou via variable d'env.

  let freesoundConfigured = false;
  try {
    const { storage } = await import("./storage");
    const allUsers = await storage.getAllUsers();
    if (allUsers.length > 0) {
      const dbConfig = await storage.getFreesoundConfig(allUsers[0].id);
      if (dbConfig && dbConfig.clientId && dbConfig.clientSecret) {
        freeSoundService.configure(dbConfig.clientId, dbConfig.clientSecret);
        freesoundConfigured = true;
        log('🎵 FreeSound configured from Database');
      }
    }
  } catch (err) {
    console.warn('Failed to load Freesound config from DB:', err);
  }

  if (!freesoundConfigured && process.env.FREESOUND_CLIENT_ID && process.env.FREESOUND_CLIENT_SECRET) {
    freeSoundService.configure(process.env.FREESOUND_CLIENT_ID, process.env.FREESOUND_CLIENT_SECRET);
    log('🎵 FreeSound configured from Environment Variables');
  } else if (!freesoundConfigured) {
    log('⚠️ FreeSound credentials not found - music search will be disabled');
  }

  // Configurer le service FFmpeg pour le traitement vidéo (si configuré)
  if (process.env.FFMPEG_API_URL && process.env.FFMPEG_API_KEY) {
    ffmpegService.configure(process.env.FFMPEG_API_URL, process.env.FFMPEG_API_KEY);
  } else {
    log('⚠️ FFmpeg API not configured - video processing will be skipped');
  }

  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);

    // Démarrer le scheduler pour les publications programmées
    schedulerService.start();

    // Start Token Refresh Cron
    startTokenCron();
  });
})();
