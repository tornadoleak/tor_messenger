import { auth, db } from "./firebase-config.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, serverTimestamp, query, where, onSnapshot, orderBy, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

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

const F = {
    escapeHtml: (str = "") => str.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"),
    normalizeId: (val = "") => val.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20),
    initials: (name = "") => (name.split(" ").filter(Boolean).slice(0, 2).map(v => v[0]?.toUpperCase()).join("") || "??"),
    uid: () => currentUser?.uid || "",
    formatTime: (ts) => ts ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(ts.toDate ? ts.toDate() : new Date(ts)) : "",
    formatLastSeen: (ts) => {
        if (!ts) return "давно";
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const diff = (new Date().getTime() - d.getTime()) / 60000;
        if (diff < 1) return "только что";
        if (diff < 60) return `${Math.floor(diff)} мин. назад`;
        if (diff < 1440) return `${Math.floor(diff/60)} ч. назад`;
        return `${Math.floor(diff/1440)} д. назад`;
    },
    randomId: (seed = "user") => `${F.normalizeId(seed).slice(0,12)||"user"}_${Math.floor(Math.random()*9e3)+1e3}`,
    getSavedTheme: () => localStorage.getItem("messenger_theme") || "dark",
    bodyTheme: (theme) => {
        document.body.classList.toggle("light", theme === "light");
        localStorage.setItem("messenger_theme", theme);
    },
};

function cardAvatar(user, small = false) {
    const { photoURL = '', nickname = '', title = '', isOnline = false } = user || {};
    const name = nickname || title;
    const onlineIndicator = isOnline ? `<div class="online-indicator"></div>` : '';
    const image = photoURL ? `<img src="${F.escapeHtml(photoURL)}" alt="">` : F.initials(name);
    return `<div class="avatar ${small?"small":""}">${image}${onlineIndicator}</div>`;
}

function showAuth(mode = "login", message = "") {
    app.innerHTML = `...`; // Auth HTML, unchanged
}

async function setupPresence() {
    if (!F.uid()) return;
    const userStatusRef = doc(db, "users", F.uid());
    await updateDoc(userStatusRef, { isOnline: true });
    window.addEventListener('beforeunload', () => {
        if (F.uid()) updateDoc(userStatus_ref, { isOnline: false, lastSeen: serverTimestamp() });
    });
}

function renderApp() {
    F.bodyTheme(currentProfile?.theme || F.getSavedTheme());
    app.innerHTML = `
      <div class="app-shell">
        <aside class="sidebar glass open">
          <div class="sidebar-header">
              <button class="profile-btn" id="settings-btn">
                  ${cardAvatar(currentProfile, true)}
                  <strong>${F.escapeHtml(currentProfile.nickname)}</strong>
              </button>
          </div>
          <div class="search-box">
            <input id="search-input" placeholder="Найти или начать новый чат">
          </div>
          <div id="search-results" class="search-results"></div>
          <div id="chat-list" class="chat-list"></div>
        </aside>
        <main id="main-content" class="center glass">
          ${renderChatArea()}
        </main>
      </div>
      <div id="modal-root"></div>
    `;
    document.getElementById("settings-btn").onclick = openSettings;
    document.getElementById("search-input").addEventListener("input", handleSearch);
    listenToChats();
    listenToUsers();
    setupPresence();
}

function renderChatArea(chat = null, messages = []) {
    currentChat = chat;
    currentChatId = chat?.id;

    if (!chat) {
        return `<div class="empty">
            <div class="empty-chat-placeholder">
                ${cardAvatar(currentProfile)}
                <h3>${currentProfile.nickname}</h3>
                <p class="muted">Выберите чат слева, чтобы начать общение,<br>или найдите собеседника через поиск.</p>
            </div>
        </div>`;
    }

    let companion = null;
    let statusText = '';
    if (chat.type === 'dm') {
        const companionId = chat.participants.find(p => p !== F.uid());
        companion = usersCache.find(u => u.uid === companionId);
        statusText = companion?.isOnline ? '<span class="success">в сети</span>' : `был(а) ${F.formatLastSeen(companion?.lastSeen)}`;
    }

    const mainContent = document.getElementById('main-content');
    if(mainContent){
        mainContent.innerHTML = `
            <div class="chat-head">
                <div class="chat-head-info">
                    <button class="btn small menu-btn" style="display:none;">☰</button>
                    ${cardAvatar(companion || chat, true)}
                    <div>
                        <h2>${F.escapeHtml(chat.title)}</h2>
                        <p id="chat-status">${statusText}</p>
                    </div>
                </div>
            </div>
            <div id="messages-box" class="messages">${messages.map(renderMessage).join("") || '<div class="empty">Сообщений пока нет.</div>'}</div>
            <form id="send-form" class="send-box">
                <button id="attach-btn" type="button" class="btn">📎</button>
                <input id="message-input" placeholder="Напиши сообщение..." autocomplete="off">
                <button class="btn primary" type="submit">➤</button>
                <input type="file" id="file-input" class="hidden">
            </form>
        `;
        document.getElementById("send-form").onsubmit = sendMessage;
        document.getElementById("attach-btn").onclick = () => document.getElementById("file-input").click();
        document.getElementById("file-input").onchange = handleFileUpload;
        document.getElementById("message-input").oninput = () => handleTyping(true);
        document.querySelector('.menu-btn').onclick = () => document.querySelector('.sidebar').classList.add('open');
        const msgBox = document.getElementById("messages-box");
        msgBox.scrollTop = msgBox.scrollHeight;

        if (window.innerWidth <= 960) {
            document.querySelector('.sidebar').classList.remove('open');
        }
    }
}

function renderMessage(msg) {
    const content = msg.fileURL
        ? `<a href="${msg.fileURL}" target="_blank" rel="noopener noreferrer">Вложение: ${F.escapeHtml(msg.fileName)}</a>`
        : F.escapeHtml(msg.text || "");
    return `<div class="msg ${msg.senderId===F.uid()?"me":""}"><div>${content}</div><div class="msg-meta">${F.escapeHtml(msg.senderName||"User")} · ${F.formatTime(msg.createdAt)}</div></div>`;
}

function listenToUsers() {
    if (unsubscribePresence) unsubscribePresence();
    unsubscribePresence = onSnapshot(collection(db, "users"), (snap) => {
        usersCache = snap.docs.map(d => d.data());
        renderChatList();
        if (currentChat?.type === 'dm') {
            const companionId = currentChat.participants.find(p => p !== F.uid());
            const companion = usersCache.find(u => u.uid === companionId);
            const statusEl = document.getElementById('chat-status');
            if(statusEl && companion && !statusEl.textContent.includes('печатает')){
                statusEl.innerHTML = companion.isOnline ? '<span class="success">в сети</span>' : `был(а) ${F.formatLastSeen(companion.lastSeen)}`;
            }
        }
    });
}

function handleSearch() {
    const q = document.getElementById("search-input").value.trim().toLowerCase();
    const resultsBox = document.getElementById("search-results");
    document.getElementById("chat-list").style.display = q ? 'none' : 'grid';
    if (!q) { resultsBox.innerHTML = ""; return; }

    const users = usersCache.filter(u => u.uid !== F.uid() && (u.nickname.toLowerCase().includes(q) || u.userId.toLowerCase().includes(q))).slice(0, 5);
    if (!users.length) { resultsBox.innerHTML = `<div class="status">Ничего не найдено.</div>`; return; }

    resultsBox.innerHTML = users.map(user => `
      <div class="result-item">
        ${cardAvatar(user, true)}
        <div><strong>${F.escapeHtml(user.nickname)}</strong><div class="muted">@${F.escapeHtml(user.userId)}</div></div>
        <button class="btn small" data-uid="${user.uid}">Чат</button>
      </div>`).join("");
    resultsBox.querySelectorAll("button[data-uid]").forEach(btn => {
        btn.onclick = async () => {
            const user = usersCache.find(u => u.uid === btn.dataset.uid);
            if (user) await createOrOpenDM(user);
            document.getElementById("search-input").value = '';
            handleSearch();
        };
    });
}

function listenToChats() {
    if (unsubscribeChats) unsubscribeChats();
    const q = query(collection(db, "chats"), where("participants", "array-contains", F.uid()), orderBy("updatedAt", "desc"));
    unsubscribeChats = onSnapshot(q, (snap) => {
        chatsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderChatList();
    });
}

function renderChatList() {
    const list = document.getElementById("chat-list");
    if (!list) return;
    if (!chatsCache.length) { list.innerHTML = `<div class="status">Пока нет чатов.</div>`; return; }
    list.innerHTML = chatsCache.map(chat => {
        let companion = null;
        if (chat.type === 'dm') {
            const companionId = chat.participants.find(p => p !== F.uid());
            companion = usersCache.find(u => u.uid === companionId);
        }
        return `<button class="chat-item ${chat.id===currentChatId?"active":""}" data-id="${chat.id}">
                    ${cardAvatar(companion || chat, true)}
                    <div><strong>${F.escapeHtml(chat.title)}</strong><span>${F.escapeHtml(chat.lastMessageText||"...")}</span></div>
                </button>`;
    }).join("");
    list.querySelectorAll(".chat-item").forEach(btn => btn.onclick = () => openChat(chatsCache.find(c => c.id === btn.dataset.id)));
}

function openChat(chat) {
    if (!chat || chat.id === currentChatId) return;
    if (unsubscribeMessages) unsubscribeMessages();
    renderChatArea(chat, []);
    
    const msgQuery = query(collection(db, "chats", chat.id, "messages"), orderBy("createdAt", "asc"));
    unsubscribeMessages = onSnapshot(msgQuery, (snap) => {
        const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (chat.id === currentChatId) renderChatArea(chat, messages);
    });

    onSnapshot(doc(db, "chats", chat.id), (doc) => {
        const chatData = doc.data();
        if(chatData?.id === currentChatId) currentChat = chatData; // Update local chat cache
        const typingUsers = chatData?.typing?.filter(u => u.uid !== F.uid()) || [];
        const statusEl = document.getElementById('chat-status');
        if (statusEl) {
            if (typingUsers.length > 0) {
                statusEl.innerHTML = `<span class="success">${typingUsers.map(u=>u.nickname).join(', ')} печатает...</span>`;
            } else if (currentChat.type === 'dm') {
                const companion = usersCache.find(u => u.uid === currentChat.participants.find(p => p !== F.uid()));
                if(companion) statusEl.innerHTML = companion.isOnline ? '<span class="success">в сети</span>' : `был(а) ${F.formatLastSeen(companion.lastSeen)}`;
            }
        }
    });
}

async function createOrOpenDM(user) {
    if (user.privacy?.allowDirectMessages === false) { alert("Этот пользователь запретил личные сообщения."); return; }
    const existing = chatsCache.find(c => c.type === "dm" && c.participants.includes(user.uid) && c.participants.includes(F.uid()));
    if (existing) { openChat(existing); return; }

    const myProfile = usersCache.find(u => u.uid === F.uid());

    const chatData = {
        type: "dm",
        participants: [F.uid(), user.uid],
        participantData: {
            [F.uid()]: { nickname: myProfile.nickname, photoURL: myProfile.photoURL, userId: myProfile.userId },
            [user.uid]: { nickname: user.nickname, photoURL: user.photoURL, userId: user.userId },
        },
        lastMessageText: "Чат создан",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        typing: [],
    };
    const chatRef = await addDoc(collection(db, "chats"), chatData);
    const newChat = { id: chatRef.id, ...((await getDoc(chatRef)).data()) };
    openChat(newChat);
}

async function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    if (!text || !currentChatId) return;
    input.value = "";
    handleTyping(false);

    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        text,
        senderId: F.uid(),
        senderName: currentProfile.nickname,
        createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", currentChatId), {
        lastMessageText: text.slice(0, 100),
        updatedAt: serverTimestamp()
    });
}

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentChatId) return;
    const fileRef = storageRef(storage, `attachments/${currentChatId}/${Date.now()}_${file.name}`);
    try {
        const snap = await uploadBytes(fileRef, file);
        const url = await getDownloadURL(snap.ref);
        await addDoc(collection(db, "chats", currentChatId, "messages"), {
            senderId: F.uid(), senderName: currentProfile.nickname, createdAt: serverTimestamp(),
            fileURL: url, fileName: file.name, fileType: file.type
        });
        await updateDoc(doc(db, "chats", currentChatId), { lastMessageText: `📎 ${file.name}`, updatedAt: serverTimestamp() });
    } catch (err) { console.error("Upload failed", err); alert("Не удалось загрузить файл."); }
}

async function handleTyping(isTyping) {
    if (!currentChatId || !currentChat) return;
    clearTimeout(typingTimeout);
    let typing = currentChat.typing || [];
    const me = { uid: F.uid(), nickname: currentProfile.nickname };

    if (isTyping) {
        if (!typing.some(u => u.uid === F.uid())) {
            typing.push(me);
            await updateDoc(doc(db, "chats", currentChatId), { typing });
        }
        typingTimeout = setTimeout(() => handleTyping(false), 3000);
    } else {
        const updatedTyping = typing.filter(u => u.uid !== F.uid());
        if (updatedTyping.length !== typing.length) {
            await updateDoc(doc(db, "chats", currentChatId), { typing: updatedTyping });
        }
    }
}

function openSettings() { /* Modal logic... */ }
async function saveSettings() { /* Modal logic... */ }
function closeModal() { document.getElementById("modal-root").innerHTML = ""; }
async function loadUserProfile(user) {
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
        const profile = {
            uid: user.uid, email: user.email, nickname: user.email.split("@")[0], userId: F.randomId(user.email.split("@")[0]), photoURL: "", bio: "", theme: F.getSavedTheme(), isOnline: false, lastSeen: serverTimestamp(),
            privacy: { searchableByNickname: true, searchableById: true, allowDirectMessages: true }, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        };
        await setDoc(ref, profile);
        snap = await getDoc(ref);
    }
    currentProfile = snap.data();
    usersCache.push(currentProfile); // Add self to user cache
}

onAuthStateChanged(auth, async (user) => {
    if (unsubscribeChats) unsubscribeChats();
    if (unsubscribeMessages) unsubscribeMessages();
    if (unsubscribePresence) unsubscribePresence();
    
    if (user && user.emailVerified) {
        currentUser = user;
        await loadUserProfile(user);
        renderApp();
    } else {
        // Handle unverified user or logged out state
        currentUser = null; currentProfile = null; currentChatId = null; currentChat = null;
        showAuth("login"); // Or showVerifyScreen if user exists but is unverified
    }
});
