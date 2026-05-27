const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── In-Memory Store ────────────────────────────────────────────────────────
const users = new Map();       // socketId → { id, username, room, status, lastSeen }
const rooms = new Map();       // roomName → [{ id, username, text, ts, room }]
const presenceTimers = new Map(); // socketId → timeout
const typingTimers = new Map();   // socketId → timeout

const DEFAULT_ROOMS = ['General', 'Random', 'Tech', 'Design', 'Music'];
DEFAULT_ROOMS.forEach(r => rooms.set(r, []));

function getRoom(name) {
  if (!rooms.has(name)) rooms.set(name, []);
  return rooms.get(name);
}

function broadcastUserList(room) {
  const online = [...users.values()]
    .filter(u => u.room === room)
    .map(u => ({ id: u.id, username: u.username, status: u.status, lastSeen: u.lastSeen }));
  io.to(room).emit('presence:list', online);
}

function broadcastAllUserList() {
  const all = [...users.values()].map(u => ({
    id: u.id, username: u.username, status: u.status, lastSeen: u.lastSeen, room: u.room
  }));
  io.emit('presence:all', all);
}

function broadcastTyping(room) {
  const typingUsers = [...users.values()]
    .filter(u => u.room === room && u.typing)
    .map(u => u.username);
  io.to(room).emit('chat:typing', typingUsers);
}

// ─── Socket Handlers ────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // User joins with a username
  socket.on('user:join', ({ username, room = 'General' }) => {
    const user = {
      id: socket.id,
      username: username.trim().slice(0, 24),
      room,
      status: 'online',
      lastSeen: Date.now(),
      typing: false,
    };
    users.set(socket.id, user);
    socket.join(room);

    // Send room history
    socket.emit('room:history', { room, messages: getRoom(room) });

    // Send rooms list with unread counts
    socket.emit('rooms:list', DEFAULT_ROOMS.map(r => ({
      name: r,
      count: getRoom(r).length,
    })));

    // System message
    const sysMsg = {
      id: `sys-${Date.now()}`,
      type: 'system',
      text: `${user.username} joined the room`,
      ts: Date.now(),
      room,
    };
    getRoom(room).push(sysMsg);
    io.to(room).emit('chat:message', sysMsg);

    broadcastUserList(room);
    broadcastAllUserList();
  });

  // Switch rooms
  socket.on('room:join', ({ room }) => {
    const user = users.get(socket.id);
    if (!user) return;

    const prevRoom = user.room;
    socket.leave(prevRoom);
    user.room = room;
    user.typing = false;
    socket.join(room);

    socket.emit('room:history', { room, messages: getRoom(room) });

    broadcastUserList(prevRoom);
    broadcastUserList(room);
    broadcastAllUserList();
  });

  // Send message
  socket.on('chat:message', ({ text, room }) => {
    const user = users.get(socket.id);
    if (!user || !text.trim()) return;

    // Stop typing on message send
    user.typing = false;
    clearTimeout(typingTimers.get(socket.id));
    broadcastTyping(room);

    const msg = {
      id: `msg-${socket.id}-${Date.now()}`,
      type: 'message',
      username: user.username,
      userId: socket.id,
      text: text.trim().slice(0, 2000),
      ts: Date.now(),
      room,
    };
    getRoom(room).push(msg);

    // Cap history at 500 messages per room
    const roomMsgs = getRoom(room);
    if (roomMsgs.length > 500) roomMsgs.splice(0, roomMsgs.length - 500);

    io.to(room).emit('chat:message', msg);
    user.lastSeen = Date.now();
  });

  // Typing start
  socket.on('chat:typing', ({ room }) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.typing = true;
    broadcastTyping(room);

    clearTimeout(typingTimers.get(socket.id));
    const t = setTimeout(() => {
      if (user) { user.typing = false; broadcastTyping(room); }
    }, 3500);
    typingTimers.set(socket.id, t);
  });

  // Typing stop
  socket.on('chat:stopTyping', ({ room }) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.typing = false;
    clearTimeout(typingTimers.get(socket.id));
    broadcastTyping(room);
  });

  // Away/active status
  socket.on('user:status', ({ status }) => {
    const user = users.get(socket.id);
    if (!user) return;
    user.status = status;
    user.lastSeen = Date.now();
    broadcastUserList(user.room);
    broadcastAllUserList();
  });

  // Search
  socket.on('chat:search', ({ query, room }) => {
    if (!query.trim()) return socket.emit('chat:searchResults', []);
    const q = query.toLowerCase();
    const results = getRoom(room)
      .filter(m => m.type === 'message' && m.text.toLowerCase().includes(q))
      .slice(-50)
      .map(m => ({ ...m, query }));
    socket.emit('chat:searchResults', results);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;

    clearTimeout(presenceTimers.get(socket.id));
    clearTimeout(typingTimers.get(socket.id));
    user.typing = false;
    broadcastTyping(user.room);

    const sysMsg = {
      id: `sys-${Date.now()}`,
      type: 'system',
      text: `${user.username} left the room`,
      ts: Date.now(),
      room: user.room,
    };
    getRoom(user.room).push(sysMsg);
    io.to(user.room).emit('chat:message', sysMsg);

    users.delete(socket.id);
    broadcastUserList(user.room);
    broadcastAllUserList();
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Chat server running at http://localhost:${PORT}`));
