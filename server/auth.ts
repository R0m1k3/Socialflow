import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import { storage } from "./storage";
import type { User } from "@shared/schema";

// Configuration de la stratégie locale
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const user = await storage.getUserByUsername(username);
      
      if (!user) {
        return done(null, false, { message: "Nom d'utilisateur ou mot de passe incorrect" });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (!isValidPassword) {
        return done(null, false, { message: "Nom d'utilisateur ou mot de passe incorrect" });
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  })
);

// Sérialisation de l'utilisateur pour la session
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as User).id);
});

// Désérialisation de l'utilisateur depuis la session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

export default passport;
