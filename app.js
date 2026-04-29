import { auth, db } from "./firebase-config.js";

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

let currentUser = null;
let currentProfile = null;
let currentChatId = null;
let chatsCache = [];
let usersCache = [];
let channelsCache = [];
let unsubscribeChats = null;
let unsubscribeMessages = null;

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

function randomTorId(seed = "tor") {
  const base = normalizeId(seed).slice(0, 12) || "tor";
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${base}_${num}`;
}

function bodyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem("tor_theme", theme);
}

function getSavedTheme() {
  return localStorage.getItem("tor_theme") || "dark";
}

function cardAvatar(photoURL, name, small = false) {
  if (photoURL) {
    return `<div class="avatar ${small ? "small" : ""}"><img src="${escapeHtml(photoURL)}" alt=""></div>`;
  }
  return `<div class="avatar ${small ? "small" : ""}">${escapeHtml(initials(name))}</div>`;
}

function showAuth(mode = "login", message = "") {
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card glass">
        <div class="brand">
          <div class="brand-orb"></div>
          <div>
            <h1>TOR</h1>
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
              <input id="torId" placeholder="TOR ID (например tornado_777)">
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
        let torId = normalizeId(document.getElementById("torId").value.trim());
        if (!torId) torId = randomTorId(nickname || email.split("@")[0]);

        const idFree = await isTorIdFree(torId);
        if (!idFree) {
          status.innerHTML = `<span class="danger">Этот TOR ID уже занят.</span>`;
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          email,
          nickname,
          torId,
          photoURL: "",
          bio: "",
          theme: getSavedTheme(),
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

        status.innerHTML = `<span class="success">Аккаунт создан. Проверь почту, подтверди email и потом входи.</span>`;
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

async function isTorIdFree(torId, exceptUid = "") {
  const snap = await getDocs(query(collection(db, "users"), where("torId", "==", torId)));
  if (snap.empty) return true;
  return snap.docs.every(d => d.id === exceptUid);
}

function renderApp() {
  bodyTheme(currentProfile?.theme || getSavedTheme());

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar glass side-actions">
        <div class="profile-dot" title="${escapeHtml(currentProfile?.nickname || "User")}">
          ${cardAvatar(currentProfile?.photoURL, currentProfile?.nickname, true)}
        </div>
        <button id="create-dm-btn" class="icon-btn" title="Новый чат">+</button>
        <button id="create-channel-btn" class="icon-btn" title="Новый канал">#</button>
        <button id="settings-btn" class="icon-btn" title="Настройки">=</button>
        <button id="logout-btn" class="icon-btn ghost" title="Выйти">x</button>
      </aside>

      <section class="inbox glass">
        <div class="inbox-head">
          <h2>Чат</h2>
          <div class="muted top-id">@${escapeHtml(currentProfile?.torId || "")}</div>
        </div>
        <div id="chat-list" class="chat-list"></div>
        <div class="search-box slim">
          <button id="clear-search-btn" class="icon-btn ghost">x</button>
          <input id="search-input" placeholder="Поиск">
          <button id="search-btn" class="icon-btn">o</button>
          <button id="top-create-chat" class="icon-btn">+</button>
        </div>
        <div id="search-results" class="search-results"></div>
      </section>

      <main class="center glass">
        <div id="chat-area"></div>
        <form id="send-form" class="send-box hidden">
          <input id="message-input" placeholder="Напиши сообщение...">
          <button class="btn primary" type="submit">Send</button>
        </form>
      </main>
    </div>

    <div id="modal-root"></div>
  `;

  document.getElementById("logout-btn").onclick = async () => {
    await signOut(auth);
  };

  document.getElementById("settings-btn").onclick = openSettings;
  document.getElementById("create-dm-btn").onclick = openCreateChatModal;
  document.getElementById("top-create-chat").onclick = openCreateChatModal;
  document.getElementById("create-channel-btn").onclick = openCreateChannelModal;
  document.getElementById("search-btn").onclick = handleSearch;
  document.getElementById("clear-search-btn").onclick = () => {
    document.getElementById("search-input").value = "";
    document.getElementById("search-results").innerHTML = "";
  };
  document.getElementById("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSearch();
  });

  document.getElementById("send-form").onsubmit = sendMessage;

  renderChatArea();
  listenChats();
  prefetchSearchData();
}

function renderChatArea(chat = null, messages = []) {
  const chatArea = document.getElementById("chat-area");
  const sendForm = document.getElementById("send-form");

  if (!chat) {
    sendForm.classList.add("hidden");
    chatArea.innerHTML = `
      <div class="empty">
        <div>
          <h3 style="margin-top:0">TOR Messenger</h3>
          <div>Открой чат из списка или создай новый диалог.</div>
        </div>
      </div>
    `;
    return;
  }

  sendForm.classList.remove("hidden");

  chatArea.innerHTML = `
    <div class="chat-head">
      <div class="chat-head-info">
        ${cardAvatar(chat.photoURL, chat.title, true)}
        <div>
          <div><strong>${escapeHtml(chat.title)}</strong></div>
          <div class="muted">${chat.type === "channel" ? "Канал" : "Личный чат"}</div>
        </div>
      </div>
      <div class="muted">${chat.type === "channel" ? (chat.isPublic ? "Public" : "Private") : "Direct"}</div>
    </div>

    <div id="messages-box" class="messages">
      ${
        messages.length
          ? messages.map(msg => `
            <div class="msg ${msg.senderId === uid() ? "me" : ""}">
              <div>${escapeHtml(msg.text || "")}</div>
              <div class="msg-meta">${escapeHtml(msg.senderName || "User")} · ${formatTime(msg.createdAt)}</div>
            </div>
          `).join("")
          : `<div class="empty">Пока сообщений нет. Отправь первое.</div>`
      }
    </div>
  `;

  const box = document.getElementById("messages-box");
  box.scrollTop = box.scrollHeight;
}

async function prefetchSearchData() {
  const usersSnap = await getDocs(collection(db, "users"));
  usersCache = usersSnap.docs.map(d => d.data()).filter(u => u.uid !== uid());

  const chatsSnap = await getDocs(collection(db, "chats"));
  channelsCache = chatsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.type === "channel" && c.isPublic);
}

function handleSearch() {
  const q = document.getElementById("search-input").value.trim().toLowerCase();
  const resultsBox = document.getElementById("search-results");
  if (!q) {
    resultsBox.innerHTML = "";
    return;
  }

  const users = usersCache.filter(u => {
    const p = u.privacy || {};
    const byNick = p.searchableByNickname !== false && (u.nickname || "").toLowerCase().includes(q);
    const byId = p.searchableById !== false && (u.torId || "").toLowerCase().includes(q);
    return byNick || byId;
  }).slice(0, 8);

  const channels = channelsCache.filter(c => {
    return (c.searchTitle || c.title || "").toLowerCase().includes(q);
  }).slice(0, 8);

  if (!users.length && !channels.length) {
    resultsBox.innerHTML = `<div class="status">Ничего не найдено.</div>`;
    return;
  }

  resultsBox.innerHTML = `
    ${users.map(user => `
      <div class="result-item">
        ${cardAvatar(user.photoURL, user.nickname, true)}
        <div>
          <strong>${escapeHtml(user.nickname)}</strong>
          <div class="muted">@${escapeHtml(user.torId)}</div>
        </div>
        <button class="btn small" data-action="dm" data-uid="${user.uid}">Чат</button>
      </div>
    `).join("")}

    ${channels.map(channel => `
      <div class="result-item">
        ${cardAvatar(channel.photoURL, channel.title, true)}
        <div>
          <strong>${escapeHtml(channel.title)}</strong>
          <div class="muted">Канал</div>
        </div>
        <button class="btn small" data-action="open-channel" data-id="${channel.id}">Открыть</button>
      </div>
    `).join("")}
  `;

  resultsBox.querySelectorAll("button[data-action='dm']").forEach(btn => {
    btn.onclick = async () => {
      const found = users.find(u => u.uid === btn.dataset.uid);
      if (found) await createOrOpenDM(found);
    };
  });

  resultsBox.querySelectorAll("button[data-action='open-channel']").forEach(btn => {
    btn.onclick = async () => {
      const found = channels.find(c => c.id === btn.dataset.id);
      if (found) openChat(found);
    };
  });
}

function listenChats() {
  if (unsubscribeChats) unsubscribeChats();

  const q = query(collection(db, "chats"), where("participants", "array-contains", uid()));
  unsubscribeChats = onSnapshot(q, (snap) => {
    chatsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    chatsCache.sort((a, b) => {
      const at = a.updatedAt?.seconds || 0;
      const bt = b.updatedAt?.seconds || 0;
      return bt - at;
    });
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

  list.innerHTML = chatsCache.map(chat => `
    <button class="chat-item ${chat.id === currentChatId ? "active" : ""}" data-id="${chat.id}">
      ${cardAvatar(chat.photoURL, chat.title, true)}
      <div>
        <strong>${escapeHtml(chat.title)}</strong>
        <span>${escapeHtml(chat.lastMessageText || "Новый чат")}</span>
      </div>
    </button>
  `).join("");

  list.querySelectorAll(".chat-item").forEach(btn => {
    btn.onclick = () => {
      const chat = chatsCache.find(c => c.id === btn.dataset.id);
      if (chat) openChat(chat);
    };
  });
}

function openChat(chat, subscribe = true) {
  currentChatId = chat.id;
  renderChatList();

  if (!subscribe) return;

  if (unsubscribeMessages) unsubscribeMessages();

  const msgQuery = query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt", "asc"));
  unsubscribeMessages = onSnapshot(msgQuery, (snap) => {
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderChatArea(chat, messages);
  });
}

async function createOrOpenDM(user) {
  const existing = chatsCache.find(chat =>
    chat.type === "dm" &&
    Array.isArray(chat.participants) &&
    chat.participants.length === 2 &&
    chat.participants.includes(uid()) &&
    chat.participants.includes(user.uid)
  );

  if (existing) {
    openChat(existing);
    return;
  }

  const chatRef = await addDoc(collection(db, "chats"), {
    type: "dm",
    title: user.nickname,
    photoURL: user.photoURL || "",
    createdBy: uid(),
    participants: [uid(), user.uid],
    searchTitle: (user.nickname || "").toLowerCase(),
    isPublic: false,
    lastMessageText: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  const newChat = {
    id: chatRef.id,
    type: "dm",
    title: user.nickname,
    photoURL: user.photoURL || "",
    createdBy: uid(),
    participants: [uid(), user.uid],
    searchTitle: (user.nickname || "").toLowerCase(),
    isPublic: false,
    lastMessageText: ""
  };

  openChat(newChat);
}

function openCreateChatModal() {
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="modal">
      <div class="modal-card glass">
        <div class="modal-head">
          <h2 style="margin:0">Новый личный чат</h2>
          <button id="close-modal" class="btn small">Закрыть</button>
        </div>
        <div class="block">
          <div class="stack">
            <div class="muted">Введи TOR ID пользователя</div>
            <input id="dm-id" placeholder="например tornado_777">
            <button id="create-dm-confirm" class="btn primary">Создать чат</button>
            <div id="dm-status" class="status">Пользователь должен разрешать личные сообщения.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("close-modal").onclick = closeModal;
  document.getElementById("create-dm-confirm").onclick = async () => {
    const status = document.getElementById("dm-status");
    const torId = normalizeId(document.getElementById("dm-id").value.trim());
    if (!torId) {
      status.innerHTML = `<span class="danger">Введи TOR ID.</span>`;
      return;
    }

    const snap = await getDocs(query(collection(db, "users"), where("torId", "==", torId)));
    if (snap.empty) {
      status.innerHTML = `<span class="danger">Пользователь не найден.</span>`;
      return;
    }

    const user = snap.docs[0].data();
    if (user.uid === uid()) {
      status.innerHTML = `<span class="danger">Нельзя создать чат с собой.</span>`;
      return;
    }

    if (user.privacy?.allowDirectMessages === false) {
      status.innerHTML = `<span class="danger">Этот пользователь запретил личные сообщения.</span>`;
      return;
    }

    await createOrOpenDM(user);
    closeModal();
  };
}

function openCreateChannelModal() {
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="modal">
      <div class="modal-card glass">
        <div class="modal-head">
          <h2 style="margin:0">Создать канал</h2>
          <button id="close-modal" class="btn small">Закрыть</button>
        </div>
        <div class="block">
          <div class="stack">
            <input id="channel-title" placeholder="Название канала">
            <input id="channel-photo" placeholder="Ссылка на аватарку канала">
            <textarea id="channel-about" placeholder="Описание"></textarea>
            <label class="check"><input id="channel-public" type="checkbox" checked> Публичный канал, виден в поиске</label>
            <button id="create-channel-confirm" class="btn primary">Создать канал</button>
            <div id="channel-status" class="status">Ты будешь владельцем канала.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("close-modal").onclick = closeModal;
  document.getElementById("create-channel-confirm").onclick = async () => {
    const status = document.getElementById("channel-status");
    const title = document.getElementById("channel-title").value.trim();
    const photoURL = document.getElementById("channel-photo").value.trim();
    const about = document.getElementById("channel-about").value.trim();
    const isPublic = document.getElementById("channel-public").checked;

    if (!title) {
      status.innerHTML = `<span class="danger">Напиши название канала.</span>`;
      return;
    }

    const ref = await addDoc(collection(db, "chats"), {
      type: "channel",
      title,
      photoURL,
      about,
      createdBy: uid(),
      participants: [uid()],
      searchTitle: title.toLowerCase(),
      isPublic,
      lastMessageText: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    closeModal();
    await prefetchSearchData();
    openChat({
      id: ref.id,
      type: "channel",
      title,
      photoURL,
      about,
      createdBy: uid(),
      participants: [uid()],
      searchTitle: title.toLowerCase(),
      isPublic,
      lastMessageText: ""
    });
  };
}

function openSettings() {
  const modalRoot = document.getElementById("modal-root");
  modalRoot.innerHTML = `
    <div class="modal">
      <div class="modal-card glass">
        <div class="modal-head">
          <h2 style="margin:0">Настройки TOR</h2>
          <button id="close-modal" class="btn small">Закрыть</button>
        </div>

        <div class="grid-2">
          <div class="block">
            <h3>Профиль</h3>
            <div class="stack">
              <input id="set-nickname" value="${escapeHtml(currentProfile?.nickname || "")}" placeholder="Ник">
              <input id="set-torid" value="${escapeHtml(currentProfile?.torId || "")}" placeholder="TOR ID">
              <input id="set-avatar" value="${escapeHtml(currentProfile?.photoURL || "")}" placeholder="Ссылка на аватарку">
              <textarea id="set-bio" placeholder="О себе">${escapeHtml(currentProfile?.bio || "")}</textarea>
            </div>
          </div>

          <div class="block">
            <h3>Тема и интерфейс</h3>
            <div class="stack">
              <select id="set-theme">
                <option value="dark" ${currentProfile?.theme === "dark" ? "selected" : ""}>Black Matte</option>
                <option value="light" ${currentProfile?.theme === "light" ? "selected" : ""}>Silver Glass</option>
              </select>

              <label class="check"><input id="set-liquid" type="checkbox" ${currentProfile?.preferences?.liquidGlass !== false ? "checked" : ""}> Liquid glass эффект</label>
              <label class="check"><input id="set-anim" type="checkbox" ${currentProfile?.preferences?.smoothAnimations !== false ? "checked" : ""}> Плавные анимации</label>
              <label class="check"><input id="set-compact" type="checkbox" ${currentProfile?.preferences?.compactMode ? "checked" : ""}> Компактный режим</label>
            </div>
          </div>

          <div class="block">
            <h3>Приватность</h3>
            <div class="stack">
              <label class="check"><input id="set-search-name" type="checkbox" ${currentProfile?.privacy?.searchableByNickname !== false ? "checked" : ""}> Можно искать по нику</label>
              <label class="check"><input id="set-search-id" type="checkbox" ${currentProfile?.privacy?.searchableById !== false ? "checked" : ""}> Можно искать по TOR ID</label>
              <label class="check"><input id="set-dm" type="checkbox" ${currentProfile?.privacy?.allowDirectMessages !== false ? "checked" : ""}> Разрешить личные сообщения</label>
              <label class="check"><input id="set-show-email" type="checkbox" ${currentProfile?.privacy?.showEmail ? "checked" : ""}> Показывать email в профиле</label>
            </div>
          </div>

          <div class="block">
            <h3>Дополнительно</h3>
            <div class="stack">
              <div class="status">Что я добавил от себя:</div>
              <div class="muted">• compact mode<br>• отключение анимаций<br>• скрытие поиска по нику / id<br>• запрет личных сообщений</div>
              <button id="save-settings" class="btn primary">Сохранить</button>
              <div id="settings-status" class="status">Сохрани изменения.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("close-modal").onclick = closeModal;
  document.getElementById("save-settings").onclick = saveSettings;
}

async function saveSettings() {
  const status = document.getElementById("settings-status");
  try {
    const nickname = document.getElementById("set-nickname").value.trim();
    const torId = normalizeId(document.getElementById("set-torid").value.trim());
    const photoURL = document.getElementById("set-avatar").value.trim();
    const bio = document.getElementById("set-bio").value.trim();
    const theme = document.getElementById("set-theme").value;
    const searchableByNickname = document.getElementById("set-search-name").checked;
    const searchableById = document.getElementById("set-search-id").checked;
    const allowDirectMessages = document.getElementById("set-dm").checked;
    const showEmail = document.getElementById("set-show-email").checked;
    const liquidGlass = document.getElementById("set-liquid").checked;
    const smoothAnimations = document.getElementById("set-anim").checked;
    const compactMode = document.getElementById("set-compact").checked;

    if (!nickname) throw new Error("Ник не может быть пустым.");
    if (!torId) throw new Error("TOR ID не может быть пустым.");

    const free = await isTorIdFree(torId, uid());
    if (!free) throw new Error("Этот TOR ID уже занят.");

    await updateDoc(doc(db, "users", uid()), {
      nickname,
      torId,
      photoURL,
      bio,
      theme,
      privacy: {
        searchableByNickname,
        searchableById,
        allowDirectMessages,
        showEmail
      },
      preferences: {
        liquidGlass,
        smoothAnimations,
        compactMode
      },
      updatedAt: serverTimestamp()
    });

    currentProfile = {
      ...currentProfile,
      nickname,
      torId,
      photoURL,
      bio,
      theme,
      privacy: {
        searchableByNickname,
        searchableById,
        allowDirectMessages,
        showEmail
      },
      preferences: {
        liquidGlass,
        smoothAnimations,
        compactMode
      }
    };

    bodyTheme(theme);
    renderApp();
    status.innerHTML = `<span class="success">Сохранено.</span>`;
    closeModal();
  } catch (err) {
    status.innerHTML = `<span class="danger">${err.message}</span>`;
  }
}

async function sendMessage(e) {
  e.preventDefault();
  if (!currentChatId) return;

  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;

  const currentChat = chatsCache.find(c => c.id === currentChatId);
  if (!currentChat) return;

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

  input.value = "";
}

function closeModal() {
  const modalRoot = document.getElementById("modal-root");
  if (modalRoot) modalRoot.innerHTML = "";
}

async function loadUserProfile(firebaseUser) {
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: firebaseUser.uid,
      email: firebaseUser.email || "",
      nickname: firebaseUser.email?.split("@")[0] || "User",
      torId: randomTorId(firebaseUser.email?.split("@")[0] || "tor"),
      photoURL: "",
      bio: "",
      theme: getSavedTheme(),
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
  }

  const finalSnap = await getDoc(ref);
  currentProfile = finalSnap.data();
}

async function showVerifyScreen(firebaseUser) {
  await loadUserProfile(firebaseUser);
  bodyTheme(currentProfile?.theme || getSavedTheme());

  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card glass">
        <div class="brand">
          <div class="brand-orb"></div>
          <div>
            <h1>TOR</h1>
            <p>Подтверди email перед входом в мессенджер</p>
          </div>
        </div>

        <div class="status">
          Ты вошел как <strong>${escapeHtml(firebaseUser.email || "")}</strong>, но почта еще не подтверждена.
        </div>

        <div class="form" style="margin-top:12px">
          <button id="resend-verify" class="btn primary">Отправить письмо еще раз</button>
          <button id="reload-check" class="btn">Я уже подтвердил</button>
          <button id="logout-verify" class="btn ghost">Выйти</button>
        </div>

        <div class="status" id="verify-status">Открой письмо от Firebase и нажми ссылку подтверждения.</div>
      </div>
    </div>
  `;

  document.getElementById("logout-verify").onclick = async () => signOut(auth);
  document.getElementById("resend-verify").onclick = async () => {
    const s = document.getElementById("verify-status");
    try {
      await sendEmailVerification(firebaseUser);
      s.innerHTML = `<span class="success">Письмо отправлено повторно.</span>`;
    } catch (err) {
      s.innerHTML = `<span class="danger">${humanError(err)}</span>`;
    }
  };

  document.getElementById("reload-check").onclick = async () => {
    const s = document.getElementById("verify-status");
    await firebaseUser.reload();
    if (auth.currentUser.emailVerified) {
      s.innerHTML = `<span class="success">Email подтвержден. Загружаю TOR...</span>`;
      currentUser = auth.currentUser;
      await loadUserProfile(currentUser);
      renderApp();
    } else {
      s.innerHTML = `<span class="danger">Подтверждение пока не найдено.</span>`;
    }
  };
}

bodyTheme(getSavedTheme());

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    currentProfile = null;
    currentChatId = null;
    if (unsubscribeChats) unsubscribeChats();
    if (unsubscribeMessages) unsubscribeMessages();
    showAuth("login");
    return;
  }

  if (!user.emailVerified) {
    await showVerifyScreen(user);
    return;
  }

  await loadUserProfile(user);
  renderApp();
});
