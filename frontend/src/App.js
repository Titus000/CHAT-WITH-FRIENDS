import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8001';

function App() {
  const [currentView, setCurrentView] = useState('login');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [ws, setWs] = useState(null);
  const [notification] = useState(new Audio('/notification.mp3'));
  
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const messageInputRef = useRef(null);

  // Login/Register states
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', email: '', password: '' });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check if user is logged in on app start
  useEffect(() => {
    if (token) {
      fetchMessages();
      connectWebSocket();
    }
  }, [token]);

  // Fetch messages
  const fetchMessages = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/messages`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  // Connect to WebSocket
  const connectWebSocket = () => {
    const wsUrl = `${BACKEND_URL.replace('http', 'ws')}/api/ws/${token}`;
    const websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      setWs(websocket);
      fetchOnlineUsers();
    };
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'message') {
        setMessages(prev => [...prev, data]);
        
        // Play notification sound if message is from another user
        if (data.user_id !== user?.id) {
          notification.play().catch(e => console.log('Audio play failed:', e));
        }
      } else if (data.type === 'user_list') {
        setOnlineUsers(data.users);
      } else if (data.type === 'typing') {
        if (data.user_id !== user?.id) {
          setTypingUsers(prev => {
            const filtered = prev.filter(u => u.user_id !== data.user_id);
            if (data.is_typing) {
              return [...filtered, data];
            }
            return filtered;
          });
        }
      }
    };
    
    websocket.onclose = () => {
      setWs(null);
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };
  };

  // Fetch online users
  const fetchOnlineUsers = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/users/online`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setOnlineUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching online users:', error);
    }
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginForm),
      });

      const data = await response.json();

      if (response.ok) {
        setToken(data.access_token);
        setUser(data.user);
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setCurrentView('chat');
      } else {
        setError(data.detail || 'Login failed');
      }
    } catch (error) {
      setError('Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle register
  const handleRegister = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${BACKEND_URL}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registerForm),
      });

      const data = await response.json();

      if (response.ok) {
        setToken(data.access_token);
        setUser(data.user);
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        setCurrentView('chat');
      } else {
        setError(data.detail || 'Registration failed');
      }
    } catch (error) {
      setError('Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setCurrentView('login');
    if (ws) {
      ws.close();
    }
  };

  // Send message
  const sendMessage = () => {
    if (newMessage.trim() && ws) {
      ws.send(JSON.stringify({
        type: 'message',
        text: newMessage.trim()
      }));
      setNewMessage('');
      setIsTyping(false);
    }
  };

  // Handle typing
  const handleTyping = (e) => {
    setNewMessage(e.target.value);
    
    if (!isTyping && ws) {
      setIsTyping(true);
      ws.send(JSON.stringify({
        type: 'typing',
        is_typing: true
      }));
    }
    
    // Clear previous timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Set timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      if (ws) {
        ws.send(JSON.stringify({
          type: 'typing',
          is_typing: false
        }));
      }
      setIsTyping(false);
    }, 1000);
  };

  // Handle enter key press
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Get user stored in localStorage
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
      setCurrentView('chat');
    }
  }, []);

  // Login View
  if (currentView === 'login') {
    return (
      <div className="app">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h1>CHAT WITH FRIENDS</h1>
              <p>Connectez-vous pour discuter avec vos amis</p>
            </div>
            
            <form onSubmit={handleLogin} className="auth-form">
              <div className="form-group">
                <input
                  type="email"
                  placeholder="Email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm({...loginForm, email: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={loginForm.password}
                  onChange={(e) => setLoginForm({...loginForm, password: e.target.value})}
                  required
                />
              </div>
              
              {error && <div className="error-message">{error}</div>}
              
              <button type="submit" className="auth-button" disabled={isLoading}>
                {isLoading ? 'Connexion...' : 'Se connecter'}
              </button>
            </form>
            
            <p className="auth-switch">
              Pas de compte ? 
              <button onClick={() => setCurrentView('register')} className="switch-button">
                S'inscrire
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Register View
  if (currentView === 'register') {
    return (
      <div className="app">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h1>CHAT WITH FRIENDS</h1>
              <p>Créez votre compte pour commencer</p>
            </div>
            
            <form onSubmit={handleRegister} className="auth-form">
              <div className="form-group">
                <input
                  type="text"
                  placeholder="Nom d'utilisateur"
                  value={registerForm.username}
                  onChange={(e) => setRegisterForm({...registerForm, username: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="email"
                  placeholder="Email"
                  value={registerForm.email}
                  onChange={(e) => setRegisterForm({...registerForm, email: e.target.value})}
                  required
                />
              </div>
              <div className="form-group">
                <input
                  type="password"
                  placeholder="Mot de passe"
                  value={registerForm.password}
                  onChange={(e) => setRegisterForm({...registerForm, password: e.target.value})}
                  required
                />
              </div>
              
              {error && <div className="error-message">{error}</div>}
              
              <button type="submit" className="auth-button" disabled={isLoading}>
                {isLoading ? 'Inscription...' : 'S\'inscrire'}
              </button>
            </form>
            
            <p className="auth-switch">
              Déjà un compte ? 
              <button onClick={() => setCurrentView('login')} className="switch-button">
                Se connecter
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Chat View
  return (
    <div className="app">
      <div className="chat-container">
        {/* Header */}
        <div className="chat-header">
          <h1>CHAT WITH FRIENDS</h1>
          <div className="header-actions">
            <span className="user-info">Salut, {user?.username}!</span>
            <button onClick={handleLogout} className="logout-button">
              Déconnexion
            </button>
          </div>
        </div>

        <div className="chat-layout">
          {/* Sidebar */}
          <div className="sidebar">
            <h3>Utilisateurs en ligne ({onlineUsers.length})</h3>
            <div className="online-users">
              {onlineUsers.map(user => (
                <div key={user.id} className="online-user">
                  <div className="user-avatar">{user.username[0].toUpperCase()}</div>
                  <span>{user.username}</span>
                  <div className="online-indicator"></div>
                </div>
              ))}
            </div>
          </div>

          {/* Chat Area */}
          <div className="chat-area">
            <div className="messages-container">
              {messages.map(message => (
                <div 
                  key={message.id} 
                  className={`message ${message.user_id === user?.id ? 'own-message' : 'other-message'}`}
                >
                  <div className="message-content">
                    <div className="message-author">{message.username}</div>
                    <div className="message-text">{message.text}</div>
                    <div className="message-time">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
              
              {/* Typing indicator */}
              {typingUsers.length > 0 && (
                <div className="typing-indicator">
                  <div className="typing-content">
                    <div className="typing-text">
                      {typingUsers.map(u => u.username).join(', ')} 
                      {typingUsers.length === 1 ? ' est en train d\'écrire' : ' sont en train d\'écrire'}
                    </div>
                    <div className="typing-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="message-input-container">
              <div className="message-input">
                <input
                  ref={messageInputRef}
                  type="text"
                  placeholder="Tapez votre message..."
                  value={newMessage}
                  onChange={handleTyping}
                  onKeyPress={handleKeyPress}
                />
                <button onClick={sendMessage} disabled={!newMessage.trim()}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 21L23 12L2 3V10L17 12L2 14V21Z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;