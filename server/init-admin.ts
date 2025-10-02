import { storage } from "./storage";
import bcrypt from "bcrypt";

export async function ensureAdminUserExists() {
  try {
    const adminUser = await storage.getUserByUsername("admin");
    
    if (!adminUser) {
      console.log("🔧 Création de l'utilisateur admin par défaut...");
      
      const hashedPassword = await bcrypt.hash("admin", 10);
      
      await storage.createUser({
        username: "admin",
        password: hashedPassword,
        role: "admin",
      });
      
      console.log("✅ Utilisateur admin créé avec succès");
      console.log("   Username: admin");
      console.log("   Password: admin");
      console.log("   ⚠️  IMPORTANT: Changez ce mot de passe immédiatement !");
    } else {
      console.log("✓ Utilisateur admin existe déjà");
    }
  } catch (error) {
    console.error("❌ Erreur lors de la vérification/création de l'utilisateur admin:", error);
    throw error;
  }
}
