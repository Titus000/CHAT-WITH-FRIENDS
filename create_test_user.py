#!/usr/bin/env python3
"""Script pour créer un utilisateur de test"""

import os
import bcrypt
import uuid
from datetime import datetime
from pymongo import MongoClient

# Configuration MongoDB
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017/')
client = MongoClient(MONGO_URL)
db = client.chat_app
users_collection = db.users

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_test_user():
    # Données de l'utilisateur de test
    test_user = {
        "id": str(uuid.uuid4()),
        "username": "testuser",
        "email": "test@example.com",
        "password": hash_password("password123"),
        "created_at": datetime.utcnow()
    }
    
    # Vérifier si l'utilisateur existe déjà
    existing_user = users_collection.find_one({"email": test_user["email"]})
    if existing_user:
        print(f"Utilisateur {test_user['email']} existe déjà!")
        return
    
    # Créer l'utilisateur
    try:
        users_collection.insert_one(test_user)
        print(f"Utilisateur créé avec succès!")
        print(f"Email: {test_user['email']}")
        print(f"Mot de passe: password123")
        print(f"Nom d'utilisateur: {test_user['username']}")
    except Exception as e:
        print(f"Erreur lors de la création de l'utilisateur: {e}")

if __name__ == "__main__":
    create_test_user()