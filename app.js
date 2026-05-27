/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  myId: null,
  myUsername: '',
  myStatus: 'online',
  currentRoom: 'General',
  rooms: [],
  users: [],
  isSearching: false,
  unreadCounts: {},
  isAtBottom: true,
  unreadNotifCount: 0,
  searchDebounce: null,
  typingDebounce: null,
  lastSender: null,
  lastSenderTs: 0,
  awayTimer: null,
};

/* ─── DOM References ─────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const modalOverlay    = $('modal-overlay');
const usernameInput   = $('username-input');
const joinBtn         = $('join-btn');
const modalError      = $('modal-error');
const appEl           = $('app');
const sidebar         = $('sidebar');
const sidebarOverlay  = createSidebarOverlay();
const hamburger       = $('hamburger');
const sidebarClose    = $('sidebar-close');
const roomsList       = $('rooms-list');
const usersList       = $('users-list');
const onlineCount     = $('online-count');
const myUsernameDis   = $('my-username-display');
const myStatusDot     = $('my-status-dot');
const headerRoomName  = $('header-room-name');
const messagesFeed    = $('messages');
const typingIndicator = $('typing-indicator');
const typingText      = $('typing-text');
const messageInput    = $('message-input');
const sendBtn         = $('send-btn');
const searchInput     = $('search-input');
const searchClear     = $('search-clear');
const searchResultsBar= $('search-results-bar');
const searchResultsCount= $('search-results-count');
const searchExit      = $('search-exit');
const notifBtn        = $('notif-btn');
const notifBadge      = $('notif-badge');
const statusBtns      = document.querySelectorAll('.status-btn');

function createSidebarOverlay() {
  const el = document.createElement('div');
  el.className = 'sidebar-overlay';
  document.body.appendChild(el);
  return el;
}

/* ─── Socket ─────────────────────────────────────────────────────────────── */
const socket = io({ autoConnect: false });

/* ─── Avatar Colors ──────────────────────────────────────────────────────── */
const AVATAR_COLORS = [
  ['#0097a7','#00bcd4'], ['#00796b','#009688'], ['#1565c0','#1976d2'],
  ['#6a1b9a','#7b1fa2'], ['#c62828','#d32f2f'], ['#2e7d32','#388e3c'],
];

function avatarColor(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) & 0xfffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function getInitials(username) {
  return username.slice(0, 2).toUpperCase();
}

function makeAvatarEl(username, size = 34) {
  const [c1, c2] = avatarColor(username);
  const el = document.createElement('div');
  el.className = 'msg-av';
  el.style.cssText = `width:${size}px;height:${size}px;background:linear-gradient(135deg,${c1},${c2});`;
  el.textContent = getInitials(username);
  return el;
}

/* ─── Time Formatting ────────────────────────────────────────────────────── */
function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function timeString(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ─── Modal Logic ────────────────────────────────────────────────────────── */
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptJoin(); });
joinBtn.addEventListener('click', attemptJoin);

function attemptJoin() {
  const val = usernameInput.value.trim();
  if (!val) { modalError.textContent = 'Please enter a username.'; return; }
  if (val.length < 2) { modalError.textContent = 'At least 2 characters.'; return; }

  state.myUsername = val;
  myUsernameDis.textContent = val;

  modalOverlay.style.opacity = '0';
  modalOverlay.style.transition = 'opacity 0.4s';
  setTimeout(() => modalOverlay.classList.add('hidden'), 400);

  appEl.classList.remove('hidden');
  appEl.style.opacity = '0';
  appEl.style.transition = 'opacity 0.4s';
  requestAnimationFrame(() => { appEl.style.opacity = '1'; });

  socket.connect();
  socket.emit('user:join', { username: val, room: state.currentRoom });

  requestNotifPermission();
  setupAway();
}

/* ─── Sidebar ─────────────────────────────────────────────────────────────── */
hamburger.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('visible');
});

sidebarClose.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
}

/* ─── Status ──────────────────────────────────────────────────────────────── */
statusBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    statusBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.myStatus = btn.dataset.status;
    myStatusDot.className = `status-dot ${state.myStatus}`;
    socket.emit('user:status', { status: state.myStatus });
  });
});

/* ─── Room Switching ─────────────────────────────────────────────────────── */
function joinRoom(roomName) {
  if (roomName === state.currentRoom) { closeSidebar(); return; }
  state.currentRoom = roomName;
  state.lastSender = null;
  headerRoomName.textContent = roomName.toLowerCase();
  messageInput.placeholder = `Message #${roomName.toLowerCase()}…`;

  messagesFeed.innerHTML = '<div class="messages-spacer"></div>';
  messagesFeed.classList.add('switching');
  setTimeout(() => messagesFeed.classList.remove('switching'), 300);

  socket.emit('room:join', { room: roomName });

  // Clear unread
  delete state.unreadCounts[roomName];
  renderRooms();
  closeSidebar();
}

/* ─── Render Rooms ─────────────────────────────────────────────────────────── */
function renderRooms() {
  roomsList.innerHTML = '';
  state.rooms.forEach(r => {
    const li = document.createElement('li');
    li.className = `room-item${r.name === state.currentRoom ? ' active' : ''}`;
    const unread = state.unreadCounts[r.name] || 0;
    li.innerHTML = `
      <span class="room-hash">#</span>
      <span class="room-name">${r.name.toLowerCase()}</span>
      ${unread > 0 ? `<span class="room-badge">${unread}</span>` : ''}
    `;
    li.addEventListener('click', () => joinRoom(r.name));
    roomsList.appendChild(li);
  });
}

/* ─── Render Users ─────────────────────────────────────────────────────────── */
function renderUsers(users) {
  state.users = users;
  const roomUsers = users.filter(u => u.room === state.currentRoom);
  onlineCount.textContent = roomUsers.filter(u => u.status === 'online').length;
  usersList.innerHTML = '';

  roomUsers.forEach(u => {
    const li = document.createElement('li');
    li.className = 'user-item';
    const [c1, c2] = avatarColor(u.username);
    li.innerHTML = `
      <div class="user-avatar" style="width:26px;height:26px;background:linear-gradient(135deg,${c1},${c2});">
        <div class="user-avatar-text">${getInitials(u.username)}</div>
      </div>
      <span class="user-name">${escapeHTML(u.username)}</span>
      <span class="status-dot ${u.status}"></span>
    `;
    usersList.appendChild(li);
  });
}

/* ─── Message Rendering ─────────────────────────────────────────────────────── */
function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlightText(text, query) {
  if (!query) return escapeHTML(text);
  const escaped = escapeHTML(text);
  const q = escapeHTML(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return escaped.replace(new RegExp(q, 'gi'), m => `<span class="search-match">${m}</span>`);
}

function renderMessage(msg, searchQuery = null, forceNewGroup = false) {
  if (msg.type === 'system') {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.dataset.msgId = msg.id;
    div.innerHTML = `<span>${escapeHTML(msg.text)}</span>`;
    messagesFeed.appendChild(div);
    return;
  }

  const isOwn = msg.userId === socket.id;
  const GROUP_THRESHOLD = 90000; // 90s
  const isCollapsed = !forceNewGroup &&
    state.lastSender === msg.username &&
    (msg.ts - state.lastSenderTs) < GROUP_THRESHOLD &&
    !state.isSearching;

  state.lastSender = msg.username;
  state.lastSenderTs = msg.ts;

  const group = document.createElement('div');
  group.className = `msg-group${isOwn ? ' own' : ''}${isCollapsed ? ' collapsed' : ''}`;
  group.dataset.msgId = msg.id;

  const avatarEl = makeAvatarEl(msg.username, 34);
  const body = document.createElement('div');
  body.className = 'msg-body';

  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerHTML = `
    <span class="msg-username" style="color:${avatarColor(msg.username)[0]}">${escapeHTML(msg.username)}</span>
    <span class="msg-time">${timeString(msg.ts)}</span>
  `;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = highlightText(msg.text, searchQuery);

  body.appendChild(meta);
  body.appendChild(bubble);
  group.appendChild(avatarEl);
  group.appendChild(body);
  messagesFeed.appendChild(group);
}

function appendHistory(messages) {
  state.lastSender = null;
  messages.forEach(m => renderMessage(m));
}

/* ─── Scroll Management ─────────────────────────────────────────────────────── */
let scrollToBottomBtn = null;

messagesFeed.addEventListener('scroll', () => {
  const distFromBottom = messagesFeed.scrollHeight - messagesFeed.scrollTop - messagesFeed.clientHeight;
  state.isAtBottom = distFromBottom < 60;

  if (!state.isAtBottom && !scrollToBottomBtn) {
    scrollToBottomBtn = document.createElement('button');
    scrollToBottomBtn.className = 'scroll-to-bottom';
    scrollToBottomBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 2v8M2 8l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      New messages
    `;
    scrollToBottomBtn.addEventListener('click', scrollToBottom);
    messagesFeed.parentElement.style.position = 'relative';
    messagesFeed.parentElement.appendChild(scrollToBottomBtn);
  } else if (state.isAtBottom && scrollToBottomBtn) {
    scrollToBottomBtn.remove();
    scrollToBottomBtn = null;
  }
});

function scrollToBottom(smooth = true) {
  messagesFeed.scrollTo({ top: messagesFeed.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
}

/* ─── Sending Messages ─────────────────────────────────────────────────────── */
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

messageInput.addEventListener('input', () => {
  // Auto-resize
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + 'px';

  // Typing indicator
  socket.emit('chat:typing', { room: state.currentRoom });
  clearTimeout(state.typingDebounce);
  state.typingDebounce = setTimeout(() => {
    socket.emit('chat:stopTyping', { room: state.currentRoom });
  }, 2500);
});

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat:message', { text, room: state.currentRoom });
  messageInput.value = '';
  messageInput.style.height = 'auto';
  socket.emit('chat:stopTyping', { room: state.currentRoom });
}

/* ─── Search ─────────────────────────────────────────────────────────────── */
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  searchClear.classList.toggle('hidden', !q);

  clearTimeout(state.searchDebounce);
  if (!q) {
    exitSearch();
    return;
  }
  state.searchDebounce = setTimeout(() => {
    socket.emit('chat:search', { query: q, room: state.currentRoom });
  }, 300);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  exitSearch();
});

searchExit.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.classList.add('hidden');
  exitSearch();
  socket.emit('room:join', { room: state.currentRoom }); // re-fetch history
});

function exitSearch() {
  state.isSearching = false;
  searchResultsBar.classList.add('hidden');
}

/* ─── Notifications ─────────────────────────────────────────────────────────── */
notifBtn.addEventListener('click', () => {
  state.unreadNotifCount = 0;
  notifBadge.classList.add('hidden');
  requestNotifPermission();
});

function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function fireNotification(msg) {
  state.unreadNotifCount++;
  notifBadge.textContent = state.unreadNotifCount > 9 ? '9+' : state.unreadNotifCount;
  notifBadge.classList.remove('hidden');

  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(`${msg.username} in #${msg.room}`, {
      body: msg.text.slice(0, 80),
      silent: false,
    });
  }
  playNotifSound();
}

function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch (_) {}
}

/* ─── Away Detection ─────────────────────────────────────────────────────── */
function setupAway() {
  const resetAway = () => {
    clearTimeout(state.awayTimer);
    if (state.myStatus !== 'online') return;
    socket.emit('user:status', { status: 'online' });
    state.awayTimer = setTimeout(() => {
      socket.emit('user:status', { status: 'away' });
    }, 5 * 60 * 1000);
  };

  ['mousemove', 'keydown', 'click', 'scroll'].forEach(ev => {
    document.addEventListener(ev, resetAway, { passive: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      socket.emit('user:status', { status: 'away' });
    } else {
      state.unreadNotifCount = 0;
      notifBadge.classList.add('hidden');
      if (state.myStatus === 'online') {
        socket.emit('user:status', { status: 'online' });
      }
    }
  });

  resetAway();
}

/* ─── Socket Events ─────────────────────────────────────────────────────── */
socket.on('connect', () => {
  state.myId = socket.id;
});

socket.on('rooms:list', (rooms) => {
  state.rooms = rooms;
  renderRooms();
});

socket.on('room:history', ({ room, messages }) => {
  if (room !== state.currentRoom) return;
  messagesFeed.innerHTML = '<div class="messages-spacer"></div>';
  state.lastSender = null;
  appendHistory(messages);
  scrollToBottom(false);
});

socket.on('chat:message', (msg) => {
  if (msg.room !== state.currentRoom) {
    // Unread badge
    state.unreadCounts[msg.room] = (state.unreadCounts[msg.room] || 0) + 1;
    renderRooms();
    if (msg.type === 'message') fireNotification(msg);
    return;
  }

  if (state.isSearching) return;

  renderMessage(msg);

  if (msg.type === 'message' && msg.userId !== socket.id && document.hidden) {
    fireNotification(msg);
  }

  if (state.isAtBottom) scrollToBottom();
});

socket.on('chat:typing', (typingUsers) => {
  // Filter out self
  const others = typingUsers.filter(u => u !== state.myUsername);
  if (others.length === 0) {
    typingIndicator.classList.add('hidden');
    return;
  }
  typingIndicator.classList.remove('hidden');
  if (others.length === 1) {
    typingText.textContent = `${others[0]} is typing…`;
  } else if (others.length === 2) {
    typingText.textContent = `${others[0]} and ${others[1]} are typing…`;
  } else {
    typingText.textContent = `${others.length} people are typing…`;
  }
});

socket.on('presence:list', (users) => {
  renderUsers(users);
});

socket.on('presence:all', (users) => {
  // Update sidebar with all rooms
  state.users = users;
  renderUsers(users);
});

socket.on('chat:searchResults', (results) => {
  state.isSearching = true;
  messagesFeed.innerHTML = '<div class="messages-spacer"></div>';
  state.lastSender = null;

  const q = searchInput.value.trim();
  searchResultsBar.classList.remove('hidden');
  searchResultsCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} for "${q}"`;

  results.forEach(msg => renderMessage(msg, q, true));
  scrollToBottom(false);
});

socket.on('disconnect', () => {
  console.log('Disconnected. Reconnecting…');
});

/* ─── Init Header Room Name ─────────────────────────────────────────────── */
headerRoomName.textContent = state.currentRoom.toLowerCase();
messageInput.placeholder = `Message #${state.currentRoom.toLowerCase()}…`;
