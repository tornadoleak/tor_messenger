import { auth, db } from "./firebase-config.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const app = document.getElementById("app");
const storage = getStorage();

let currentUser = null;
let currentProfile = null;
let currentChatId = null;
let currentChat = null;
let chatsCache = [];
let usersCache = [];
let unsubscribeChats = null;
let unsubscribeMessages = null;
let unsubscribePresence = null;
let typingTimeout = null;


function escapeHtml(str = "") {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeId(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(v => v[0]?.toUpperCase())
    .join("") || "T";
}

function uid() {
  return currentUser?.uid || "";
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);
}

function formatLastSeen(ts) {
    if (!ts) return "давно";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "только что";
    if (minutes < 60) return `${minutes} мин. назад`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ч. назад`;
    const days = Math.floor(hours / 24);
    return `${days} д. назад`;
}

function randomId(seed = "user") {
  const base = normalizeId(seed).slice(0, 12) || "user";
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${base}_${num}`;
}

function bodyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem("messenger_theme", theme);
}

function getSavedTheme() {
  return localStorage.getItem("messenger_theme") || "dark";
}

function cardAvatar(user, small = false) {
    const photoURL = user?.photoURL || '';
    const name = user?.nickname || user?.title || '';
    const isOnline = user?.isOnline || false;

    const onlineIndicator = isOnline ? `<div class="online-indicator"></div>` : '';

    if (photoURL) {
        return `<div class="avatar ${small ? "small" : ""}"><img src="${escapeHtml(photoURL)}" alt="">${onlineIndicator}</div>`;
    }
    return `<div class="avatar ${small ? "small" : ""}">${escapeHtml(initials(name))}${onlineIndicator}</div>`;
}

function showAuth(mode = "login", message = "") {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card glass">
        <div class="brand">
          <div class="brand-orb"></div>
          <div>
            <h1>MESSENGER</h1>
            <p>Черно-матовый liquid glass messenger</p>
          </div>
        </div>

        <div class="tabs">
          <button id="tab-login" class="${mode === "login" ? "active" : ""}">Вход</button>
          <button id="tab-register" class="${mode === "register" ? "active" : ""}">Регистрация</button>
        </div>

        <form id="auth-form" class="form">
          ${
            mode === "register"
              ? `
              <input id="nickname" placeholder="Ник" required>
              <input id="userId" placeholder="ID (например tornado_777)">
            `
              : ""
          }
          <input id="email" type="email" placeholder="Email" required>
          <input id="password" type="password" placeholder="Пароль (минимум 6 символов)" required>
          <button class="btn primary" type="submit">${mode === "register" ? "Создать аккаунт" : "Войти"}</button>
        </form>

        <div class="status" id="auth-status">${message || "После регистрации на почту придет письмо для подтверждения email."}</div>
      </div>
    </div>
  `;

  document.getElementById("tab-login").onclick = () => showAuth("login");
  document.getElementById("tab-register").onclick = () => showAuth("register");

  document.getElementById("auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const status = document.getElementById("auth-status");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
      if (mode === "register") {
        const nickname = document.getElementById("nickname").value.trim();
        let userId = normalizeId(document.getElementById("userId").value.trim());
        if (!userId) userId = randomId(nickname || email.split("@")[0]);

        const idFree = await isIdFree(userId);
        if (!idFree) {
          status.innerHTML = `<span class="danger">Этот ID уже занят.</span>`;
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          email,
          nickname,
          userId,
          photoURL: "",
          bio: "",
          theme: getSavedTheme(),
          isOnline: false,
          lastSeen: serverTimestamp(),
          privacy: {
            searchableByNickname: true,
            searchableById: true,
            allowDirectMessages: true,
            showEmail: false
          },
          preferences: {
            liquidGlass: true,
            smoothAnimations: true,
            compactMode: false
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        await sendEmailVerification(cred.user);
        await signOut(auth);
        showAuth("login", "Аккаунт создан. Теперь войди после подтверждения email.");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      status.innerHTML = `<span class="danger">${humanError(err)}</span>`;
    }
  };
}

function humanError(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "Этот email уже зарегистрирован.";
  if (code.includes("invalid-email")) return "Некорректный email.";
  if (code.includes("weak-password")) return "Слишком слабый пароль.";
  if (code.includes("invalid-credential")) return "Неверный email или пароль.";
  if (code.includes("too-many-requests")) return "Слишком много попыток. Попробуй позже.";
  return err?.message || "Ошибка.";
}

async function isIdFree(userId, exceptUid = "") {
  const snap = await getDocs(query(collection(db, "users"), where("userId", "==", userId)));
  if (snap.empty) return true;
  return snap.docs.every(d => d.id === exceptUid);
}

function setupPresence() {
    const userStatusRef = doc(db, "users", uid());
    window.addEventListener('beforeunload', () => {
        updateDoc(userStatusRef, { isOnline: false, lastSeen: serverTimestamp() });
    });
    updateDoc(userStatusRef, { isOnline: true });
}

function renderApp() {
  bodyTheme(currentProfile?.theme || getSavedTheme());

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar glass">
        <div class="sidebar-header">
            <button id="menu-btn" class="btn">☰</button>
            <div style="flex:1">
                <input id="search-input" placeholder="Ник, ID, канал">
            </div>
            <button id="search-btn" class="btn primary">🔎</button>
        </div>
        <div id="search-results" class="search-results"></div>
        <div id="chat-list" class="chat-list"></div>
      </aside>

      <main id="main-content" class="center glass">
        <div id="chat-area"></div>
      </main>
    </div>
    <div id="modal-root"></div>
  `;

  document.getElementById("menu-btn").onclick = openSettings;
  document.getElementById("search-btn").onclick = handleSearch;
  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });
  
  renderChatArea();
  listenToChats();
  prefetchUsers();
  setupPresence();
}

function renderChatArea(chat = null, messages = []) {
  const chatArea = document.getElementById("chat-area");

  if (!chat) {
    chatArea.innerHTML = `
      <div class="empty">
        <div>
          <h3 style="margin-top:0">Добро пожаловать</h3>
          <div>Выберите чат для начала общения.</div>
        </div>
      </div>
    `;
    if(document.getElementById("send-form")) document.getElementById("send-form").remove();
    return;
  }
  
  let companion = null;
  if(chat.type === 'dm'){
      const companionId = chat.participants.find(p => p !== uid());
      companion = usersCache.find(u => u.uid === companionId);
  }

  const statusText = companion ? (companion.isOnline ? '<span class="success">в сети</span>' : `был(а) ${formatLastSeen(companion.lastSeen)}`) : (chat.type === "channel" ? `${chat.participants.length} участник(ов)` : '');
  
  chatArea.innerHTML = `
    <div class="chat-head">
      <div class="chat-head-info">
        <button id="back-to-chats" class="btn small" style="display:none;">←</button>
        ${cardAvatar(companion || chat, true)}
        <div>
          <h2>${escapeHtml(chat.title)}</h2>
          <p id="chat-status">${statusText}</p>
        </div>
      </div>
    </div>

    <div id="messages-box" class="messages">
      ${
        messages.length
          ? messages.map(msg => renderMessage(msg)).join("")
          : `<div class="empty">Сообщений пока нет.</div>`
      }
    </div>
    
    <form id="send-form" class="send-box">
      <button id="attach-btn" type="button" class="btn">📎</button>
      <input id="message-input" placeholder="Напиши сообщение...">
      <button class="btn primary" type="submit">➤</button>
      <input type="file" id="file-input" class="hidden">
    </form>
  `;

  const msgBox = document.getElementById("messages-box");
  msgBox.scrollTop = msgBox.scrollHeight;

  document.getElementById("send-form").onsubmit = sendMessage;
  document.getElementById("attach-btn").onclick = () => document.getElementById("file-input").click();
  document.getElementById("file-input").onchange = handleFileUpload;
  document.getElementById("message-input").oninput = handleTyping;
  
  if(window.innerWidth <= 960){
      document.querySelector('.sidebar').classList.remove('open');
      document.getElementById('back-to-chats').onclick = () => {
          document.querySelector('.sidebar').classList.add('open');
      };
  }
}

function renderMessage(msg){
    let content = '';
    if(msg.fileURL){
        content = `<a href="${msg.fileURL}" target="_blank" rel="noopener noreferrer">Вложение: ${msg.fileName}</a>`;
    } else {
        content = escapeHtml(msg.text || "");
    }

    return `
        <div class="msg ${msg.senderId === uid() ? "me" : ""}">
          <div>${content}</div>
          <div class="msg-meta">${escapeHtml(msg.senderName || "User")} · ${formatTime(msg.createdAt)}</div>
        </div>
    `;
}

async function prefetchUsers() {
    const usersSnap = await getDocs(collection(db, "users"));
    usersCache = usersSnap.docs.map(d => d.data());
    
    // Listen for presence changes
    if(unsubscribePresence) unsubscribePresence();
    unsubscribePresence = onSnapshot(collection(db, "users"), (snap) => {
        usersCache = snap.docs.map(d => d.data());
        renderChatList();
        if(currentChat) {
            const chatArea = document.getElementById("chat-area");
            if(chatArea) {
                const companionId = currentChat.participants.find(p => p !== uid());
                const companion = usersCache.find(u => u.uid === companionId);
                const statusEl = document.getElementById('chat-status');
                if(statusEl && companion){
                    statusEl.innerHTML = companion.isOnline ? '<span class="success">в сети</span>' : `был(а) ${formatLastSeen(companion.lastSeen)}`;
                }
            }
        }
    });
}

function handleSearch() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  const resultsBox = document.getElementById("search-results");
  const chatListBox = document.getElementById("chat-list");

  if (!q) {
    resultsBox.innerHTML = "";
    chatListBox.style.display = 'grid';
    return;
  }
  
  chatListBox.style.display = 'none';

  const users = usersCache.filter(u => {
    const p = u.privacy || {};
    const byNick = p.searchableByNickname !== false && (u.nickname || "").toLowerCase().includes(q);
    const byId = p.searchableById !== false && (u.userId || "").toLowerCase().includes(q);
    return (byNick || byId) && u.uid !== uid();
  }).slice(0, 8);
  
  // Public channel search would go here

  if (!users.length) {
    resultsBox.innerHTML = `<div class="status">Ничего не найдено.</div>`;
    return;
  }

  resultsBox.innerHTML = `
    ${users.map(user => `
      <div class="result-item">
        ${cardAvatar(user, true)}
        <div>
          <strong>${escapeHtml(user.nickname)}</strong>
          <div class="muted">@${escapeHtml(user.userId)}</div>
        </div>
        <button class="btn small" data-action="dm" data-uid="${user.uid}">Чат</button>
      </div>
    `).join("")}
  `;

  resultsBox.querySelectorAll("button[data-action='dm']").forEach(btn => {
    btn.onclick = async () => {
      const foundUser = users.find(u => u.uid === btn.dataset.uid);
      if (foundUser) {
          await createOrOpenDM(foundUser);
          document.getElementById("search-input").value = '';
          resultsBox.innerHTML = "";
          chatListBox.style.display = 'grid';
      }
    };
  });
}

function listenToChats() {
  if (unsubscribeChats) unsubscribeChats();

  const q = query(collection(db, "chats"), where("participants", "array-contains", uid()), orderBy("updatedAt", "desc"));
  unsubscribeChats = onSnapshot(q, (snap) => {
    chatsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderChatList();
    
    if (currentChatId) {
      const selected = chatsCache.find(c => c.id === currentChatId);
      if (selected) openChat(selected, false);
    }
  });
}

function renderChatList() {
  const list = document.getElementById("chat-list");
  if (!list) return;

  if (!chatsCache.length) {
    list.innerHTML = `<div class="status">Пока нет чатов.</div>`;
    return;
  }

  list.innerHTML = chatsCache.map(chat => {
      let companion = null;
      if(chat.type === 'dm'){
          const companionId = chat.participants.find(p => p !== uid());
          companion = usersCache.find(u => u.uid === companionId);
      }
      return `
        <button class="chat-item ${chat.id === currentChatId ? "active" : ""}" data-id="${chat.id}">
          ${cardAvatar(companion || chat, true)}
          <div>
            <strong>${escapeHtml(chat.title)}</strong>
            <span>${escapeHtml(chat.lastMessageText || "Новый чат")}</span>
          </div>
        </button>
      `
  }).join("");

  list.querySelectorAll(".chat-item").forEach(btn => {
    btn.onclick = () => {
      const chat = chatsCache.find(c => c.id === btn.dataset.id);
      if (chat) openChat(chat);
    };
  });
}

function openChat(chat, subscribe = true) {
  currentChatId = chat.id;
  currentChat = chat;
  renderChatList();

  if(window.innerWidth <= 960){
      document.querySelector('.sidebar').classList.remove('open');
  }

  if (subscribe) {
    if (unsubscribeMessages) unsubscribeMessages();

    const msgQuery = query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt", "asc"));
    unsubscribeMessages = onSnapshot(msgQuery, (snap) => {
      const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderChatArea(chat, messages);
    });
    
    // Listen for typing status
    onSnapshot(doc(db, "chats", chat.id), (doc) => {
        const typingUsers = doc.data()?.typing || [];
        const otherTypingUsers = typingUsers.filter(u => u.uid !== uid() && u.nickname);
        const statusEl = document.getElementById('chat-status');
        if(statusEl){
            if(otherTypingUsers.length > 0){
                statusEl.innerHTML = `<span class="success">${otherTypingUsers.map(u=>u.nickname).join(', ')} печатает...</span>`;
            } else {
                 const companionId = chat.participants.find(p => p !== uid());
                 const companion = usersCache.find(u => u.uid === companionId);
                 if(companion) {
                    statusEl.innerHTML = companion.isOnline ? '<span class="success">в сети</span>' : `был(а) ${formatLastSeen(companion.lastSeen)}`;
                 }
            }
        }
    });

  } else {
      renderChatArea(chat, []);
  }
}

async function createOrOpenDM(user) {
  const existing = chatsCache.find(chat =>
    chat.type === "dm" && chat.participants.length === 2 &&
    chat.participants.includes(uid()) && chat.participants.includes(user.uid)
  );

  if (existing) {
    openChat(existing);
    return;
  }
  
  if (user.privacy?.allowDirectMessages === false) {
      alert("Этот пользователь запретил личные сообщения.");
      return;
  }

  const chatRef = await addDoc(collection(db, "chats"), {
    type: "dm",
    title: user.nickname,
    photoURL: user.photoURL || "",
    createdBy: uid(),
    participants: [uid(), user.uid],
    participantData: {
        [uid()]: { nickname: currentProfile.nickname, photoURL: currentProfile.photoURL },
        [user.uid]: { nickname: user.nickname, photoURL: user.photoURL }
    },
    isPublic: false,
    lastMessageText: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const newChat = { id: chatRef.id, ...((await getDoc(chatRef)).data()) };
  openChat(newChat);
}


async function sendMessage(e) {
  e.preventDefault();
  if (!currentChatId) return;

  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  
  await addDoc(collection(db, "chats", currentChatId, "messages"), {
    text,
    senderId: uid(),
    senderName: currentProfile.nickname,
    createdAt: serverTimestamp()
  });

  await updateDoc(doc(db, "chats", currentChatId), {
    lastMessageText: text.slice(0, 120),
    updatedAt: serverTimestamp()
  });
  
  handleTyping(false); // Stop typing indicator
}

async function handleFileUpload(e){
    const file = e.target.files[0];
    if(!file) return;

    const fileRef = storageRef(storage, `attachments/${currentChatId}/${Date.now()}_${file.name}`);
    
    try {
        const uploadTask = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(uploadTask.ref);

        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            senderId: uid(),
            senderName: currentProfile.nickname,
            createdAt: serverTimestamp(),
            fileURL: downloadURL,
            fileName: file.name,
            fileType: file.type
        });

        await updateDoc(doc(db, "chats", currentChatId), {
            lastMessageText: `📎 ${file.name}`,
            updatedAt: serverTimestamp()
        });

    } catch(err) {
        console.error("Upload failed", err);
        alert("Не удалось загрузить файл.");
    }
}

async function handleTyping(isTyping = true) {
    if (!currentChatId) return;
    const chatRef = doc(db, "chats", currentChatId);
    
    let currentTypingUsers = currentChat?.typing || [];
    const me = { uid: uid(), nickname: currentProfile.nickname };

    // Clear previous timeout
    clearTimeout(typingTimeout);
    
    if(isTyping){
        // Add user to typing list if not already there
        if(!currentTypingUsers.some(u => u.uid === uid())){
            currentTypingUsers.push(me);
            await updateDoc(chatRef, { typing: currentTypingUsers });
        }
        
        // Set timeout to remove user from typing list
        typingTimeout = setTimeout(() => {
            handleTyping(false);
        }, 3000);

    } else {
        // Remove user from typing list
        const updatedTypingUsers = currentTypingUsers.filter(u => u.uid !== uid());
        if(updatedTypingUsers.length !== currentTypingUsers.length){
            await updateDoc(chatRef, { typing: updatedTypingUsers });
        }
    }
}


function openSettings() {
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="modal">
      <div class="modal-card glass">
        <div class="modal-head">
          <h2 style="margin:0">Настройки</h2>
          <button id="close-modal" class="btn small">Закрыть</button>
        </div>

        <div class="grid-2">
          <div class="block">
            <h3>Профиль</h3>
            <div class="stack">
                <div class="profile-card" style="justify-content:center;">
                    ${cardAvatar(currentProfile)}
                </div>
                <input type="file" id="avatar-upload" class="hidden">
                <button id="avatar-upload-btn" class="btn">Сменить аватар</button>
                <input id="set-nickname" value="${escapeHtml(currentProfile?.nickname || "")}" placeholder="Ник">
                <input id="set-id" value="${escapeHtml(currentProfile?.userId || "")}" placeholder="ID">
                <textarea id="set-bio" placeholder="О себе">${escapeHtml(currentProfile?.bio || "")}</textarea>
            </div>
          </div>
           <div class="block">
            <h3>Приватность и другое</h3>
            <div class="stack">
              <label class="check"><input id="set-search-name" type="checkbox" ${currentProfile?.privacy?.searchableByNickname !== false ? "checked" : ""}> Можно искать по нику</label>
              <label class="check"><input id="set-search-id" type="checkbox" ${currentProfile?.privacy?.searchableById !== false ? "checked" : ""}> Можно искать по ID</label>
              <label class="check"><input id="set-dm" type="checkbox" ${currentProfile?.privacy?.allowDirectMessages !== false ? "checked" : ""}> Разрешить личные сообщения</label>
              
              <select id="set-theme">
                <option value="dark" ${currentProfile?.theme === "dark" ? "selected" : ""}>Black Matte</option>
                <option value="light" ${currentProfile?.theme === "light" ? "selected" : ""}>Silver Glass</option>
              </select>
              
              <button id="save-settings" class="btn primary">Сохранить</button>
              <button id="logout-btn" class="btn ghost danger">Выйти</button>
              <div id="settings-status" class="status"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("close-modal").onclick = closeModal;
  document.getElementById("save-settings").onclick = saveSettings;
  document.getElementById("logout-btn").onclick = () => signOut(auth);
  document.getElementById("avatar-upload-btn").onclick = () => document.getElementById("avatar-upload").click();
  document.getElementById("avatar-upload").onchange = handleAvatarUpload;
}

async function handleAvatarUpload(e){
    const file = e.target.files[0];
    if(!file) return;

    const status = document.getElementById("settings-status");
    status.innerHTML = "Загрузка аватара...";

    const fileRef = storageRef(storage, `avatars/${uid()}`);
    
    try {
        const uploadTask = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(uploadTask.ref);

        await updateDoc(doc(db, "users", uid()), { photoURL: downloadURL });
        currentProfile.photoURL = downloadURL;
        status.innerHTML = `<span class="success">Аватар обновлен!</span>`;
        openSettings(); // Re-render settings to show new avatar
    } catch (err) {
        status.innerHTML = `<span class="danger">Ошибка загрузки.</span>`;
    }
}

async function saveSettings() {
  const status = document.getElementById("settings-status");
  try {
    const nickname = document.getElementById("set-nickname").value.trim();
    const userId = normalizeId(document.getElementById("set-id").value.trim());
    const bio = document.getElementById("set-bio").value.trim();
    const theme = document.getElementById("set-theme").value;
    const searchableByNickname = document.getElementById("set-search-name").checked;
    const searchableById = document.getElementById("set-search-id").checked;
    const allowDirectMessages = document.getElementById("set-dm").checked;

    if (!nickname) throw new Error("Ник не может быть пустым.");
    if (!userId) throw new Error("ID не может быть пустым.");

    const free = await isIdFree(userId, uid());
    if (!free) throw new Error("Этот ID уже занят.");

    const updates = {
      nickname,
      userId,
      bio,
      theme,
      privacy: { ...currentProfile.privacy, searchableByNickname, searchableById, allowDirectMessages },
      updatedAt: serverTimestamp()
    };
    
    await updateDoc(doc(db, "users", uid()), updates);

    currentProfile = { ...currentProfile, ...updates };

    bodyTheme(theme);
    status.innerHTML = `<span class="success">Сохранено.</span>`;
    setTimeout(closeModal, 1000);
  } catch (err) {
    status.innerHTML = `<span class="danger">${err.message}</span>`;
  }
}

function closeModal() {
  const modalRoot = document.getElementById("modal-root");
  if (modalRoot) modalRoot.innerHTML = "";
}

async function loadUserProfile(firebaseUser) {
    const ref = doc(db, "users", firebaseUser.uid);
    let snap = await getDoc(ref);

    if (!snap.exists()) {
        const initialProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || "",
            nickname: firebaseUser.email?.split("@")[0] || "User",
            userId: randomId(firebaseUser.email?.split("@")[0] || "user"),
            photoURL: "",
            bio: "",
            theme: getSavedTheme(),
            isOnline: false,
            lastSeen: serverTimestamp(),
            privacy: { searchableByNickname: true, searchableById: true, allowDirectMessages: true, showEmail: false },
            preferences: { liquidGlass: true, smoothAnimations: true, compactMode: false },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        await setDoc(ref, initialProfile);
        snap = await getDoc(ref);
    }
    currentProfile = snap.data();
}

async function showVerifyScreen(firebaseUser) {
  // ... (this function can remain mostly the same)
}

// MAIN APP LOGIC
bodyTheme(getSavedTheme());

onAuthStateChanged(auth, async (user) => {
  if (unsubscribeChats) unsubscribeChats();
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribePresence) unsubscribePresence();
  
  if (user) {
    currentUser = user;
    if (!user.emailVerified) {
      await showVerifyScreen(user);
    } else {
      await loadUserProfile(user);
      renderApp();
    }
  } else {
    currentUser = null;
    currentProfile = null;
    currentChatId = null;
    currentChat = null;
    showAuth("login");
  }
});
