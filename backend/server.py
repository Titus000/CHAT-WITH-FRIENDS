from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError
import os
import json
import bcrypt
import uuid
from datetime import datetime, timedelta
import asyncio
from typing import List, Dict, Optional
import jwt
from jwt.exceptions import InvalidTokenError

# Environment setup
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017/')
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-here')
JWT_ALGORITHM = 'HS256'

# MongoDB setup
client = MongoClient(MONGO_URL)
db = client.chat_app
users_collection = db.users
messages_collection = db.messages

# FastAPI app setup
app = FastAPI(title="Chat with Friends API")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

# Pydantic models
class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Message(BaseModel):
    text: str

class TypingStatus(BaseModel):
    is_typing: bool

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_connections: Dict[str, str] = {}  # user_id -> connection_id
        
    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        connection_id = str(uuid.uuid4())
        self.active_connections[connection_id] = websocket
        self.user_connections[user_id] = connection_id
        
        # Send updated user list to all connections
        await self.broadcast_user_list()
        return connection_id
        
    def disconnect(self, connection_id: str):
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]
        
        # Remove from user connections
        user_to_remove = None
        for user_id, conn_id in self.user_connections.items():
            if conn_id == connection_id:
                user_to_remove = user_id
                break
        
        if user_to_remove:
            del self.user_connections[user_to_remove]
    
    async def send_personal_message(self, message: str, connection_id: str):
        websocket = self.active_connections.get(connection_id)
        if websocket:
            await websocket.send_text(message)
    
    async def broadcast(self, message: str):
        for connection in self.active_connections.values():
            try:
                await connection.send_text(message)
            except:
                pass
    
    async def broadcast_user_list(self):
        connected_users = []
        for user_id in self.user_connections.keys():
            user = users_collection.find_one({"id": user_id})
            if user:
                connected_users.append({
                    "id": user["id"],
                    "username": user["username"]
                })
        
        message = {
            "type": "user_list",
            "users": connected_users
        }
        await self.broadcast(json.dumps(message))

manager = ConnectionManager()

# Helper functions
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_access_token(data: dict):
    expire = datetime.utcnow() + timedelta(hours=24)
    to_encode = data.copy()
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def verify_token(token: str):
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except InvalidTokenError:
        return None

def get_current_user(token: str = Depends(security)):
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = verify_token(token.credentials)
        if payload is None:
            raise credentials_exception
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except InvalidTokenError:
        raise credentials_exception
    
    user = users_collection.find_one({"id": user_id})
    if user is None:
        raise credentials_exception
    return user

# API Routes
@app.post("/api/register")
async def register(user: UserRegister):
    # Check if user already exists
    if users_collection.find_one({"email": user.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    if users_collection.find_one({"username": user.username}):
        raise HTTPException(status_code=400, detail="Username already taken")
    
    # Create new user
    user_id = str(uuid.uuid4())
    hashed_password = hash_password(user.password)
    
    new_user = {
        "id": user_id,
        "username": user.username,
        "email": user.email,
        "password": hashed_password,
        "created_at": datetime.utcnow()
    }
    
    users_collection.insert_one(new_user)
    
    # Create access token
    access_token = create_access_token(data={"sub": user_id})
    
    return {
        "message": "User created successfully",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "username": user.username,
            "email": user.email
        }
    }

@app.post("/api/login")
async def login(user: UserLogin):
    # Find user
    db_user = users_collection.find_one({"email": user.email})
    if not db_user or not verify_password(user.password, db_user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Create access token
    access_token = create_access_token(data={"sub": db_user["id"]})
    
    return {
        "message": "Login successful",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": db_user["id"],
            "username": db_user["username"],
            "email": db_user["email"]
        }
    }

@app.get("/api/messages")
async def get_messages(current_user: dict = Depends(get_current_user)):
    messages = list(messages_collection.find().sort("timestamp", 1).limit(100))
    
    # Convert ObjectId to string and format messages
    formatted_messages = []
    for msg in messages:
        user = users_collection.find_one({"id": msg["user_id"]})
        formatted_messages.append({
            "id": msg["id"],
            "text": msg["text"],
            "username": user["username"] if user else "Unknown",
            "user_id": msg["user_id"],
            "timestamp": msg["timestamp"].isoformat()
        })
    
    return {"messages": formatted_messages}

@app.get("/api/users/online")
async def get_online_users(current_user: dict = Depends(get_current_user)):
    connected_users = []
    for user_id in manager.user_connections.keys():
        user = users_collection.find_one({"id": user_id})
        if user:
            connected_users.append({
                "id": user["id"],
                "username": user["username"]
            })
    
    return {"users": connected_users}

@app.websocket("/api/ws/{token}")
async def websocket_endpoint(websocket: WebSocket, token: str):
    # Verify token
    payload = verify_token(token)
    if not payload:
        await websocket.close(code=1008, reason="Invalid token")
        return
    
    user_id = payload.get("sub")
    user = users_collection.find_one({"id": user_id})
    if not user:
        await websocket.close(code=1008, reason="User not found")
        return
    
    connection_id = await manager.connect(websocket, user_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            if message_data.get("type") == "message":
                # Save message to database
                message_id = str(uuid.uuid4())
                message = {
                    "id": message_id,
                    "text": message_data["text"],
                    "user_id": user_id,
                    "timestamp": datetime.utcnow()
                }
                messages_collection.insert_one(message)
                
                # Broadcast message to all connected users
                broadcast_message = {
                    "type": "message",
                    "id": message_id,
                    "text": message_data["text"],
                    "username": user["username"],
                    "user_id": user_id,
                    "timestamp": message["timestamp"].isoformat()
                }
                await manager.broadcast(json.dumps(broadcast_message))
                
            elif message_data.get("type") == "typing":
                # Broadcast typing status
                typing_message = {
                    "type": "typing",
                    "username": user["username"],
                    "user_id": user_id,
                    "is_typing": message_data.get("is_typing", False)
                }
                await manager.broadcast(json.dumps(typing_message))
                
    except WebSocketDisconnect:
        manager.disconnect(connection_id)
        await manager.broadcast_user_list()

@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)