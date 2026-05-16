import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, push, onChildAdded, set, onValue, remove, onDisconnect, query, orderByChild, endAt, get } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// إعدادات مشروع Firebase الخاص بك
const firebaseConfig = {
    apiKey: "AIzaSyArg6aPnPyd0x5C2HbZ8o5wpVmhmmSYS6Q",
    authDomain: "fn1998.firebaseapp.com",
    projectId: "fn1998",
    storageBucket: "fn1998.firebasestorage.app",
    messagingSenderId: "326727010464",
    appId: "1:326727010464:web:831654b2593ae59d5821c5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const messagesRef = ref(db, 'room-messages');
const micsRef = ref(db, 'room-mics'); 

const myName = "أمير_" + Math.floor(Math.random() * 1000);
let myCurrentMicIndex = -1;
let myPeerId = null;
let localStream = null;
let activeConnections = {}; 
let globalMicsData = {}; 

const appContainer = document.getElementById('appContainer');

// --------------------------------------------------------
// نظام استعادة وحفظ الخلفية المختارة تلقائياً (LocalStorage)
// --------------------------------------------------------
const savedBg = localStorage.getItem('room-wallpaper');
if (savedBg && savedBg !== 'none') {
    appContainer.style.backgroundImage = `url('${savedBg}')`;
    setTimeout(() => {
        const activeOption = document.querySelector(`.bg-option[data-bg="${savedBg}"]`);
        if (activeOption) activeOption.classList.add('selected');
    }, 500);
} else {
    setTimeout(() => {
        const defaultOption = document.querySelector('.default-bg');
        if (defaultOption) defaultOption.classList.add('selected');
    }, 500);
}

// --------------------------------------------------------
// وظيفة حذف الرسائل تلقائياً كل 12 ساعة للحفاظ على قاعدة البيانات
// --------------------------------------------------------
function cleanupOldMessages() {
    const twelveHoursInMs = 12 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - twelveHoursInMs;
    const oldMessagesQuery = query(messagesRef, orderByChild('timestamp'), endAt(cutoffTime));
    
    get(oldMessagesQuery).then((snapshot) => {
        snapshot.forEach((child) => {
            remove(child.ref);
        });
    }).catch(err => console.log("خطأ في تنظيف البيانات:", err));
}
cleanupOldMessages();

// --------------------------------------------------------
// نافذة التنبيهات المخصصة الاحترافية (بديل رسائل الكروم)
// --------------------------------------------------------
function showCustomModal(title, message, isConfirm = false) {
    return new Promise((resolve) => {
        const modal = document.getElementById('customModal');
        const titleEl = document.getElementById('modalTitle');
        const msgEl = document.getElementById('modalMessage');
        const btnYes = document.getElementById('modalBtnYes');
        const btnNo = document.getElementById('modalBtnNo');

        titleEl.innerText = title;
        msgEl.innerText = message;
        
        if(isConfirm) {
            btnNo.style.display = 'block';
            btnYes.innerText = "نعم";
        } else {
            btnNo.style.display = 'none';
            btnYes.innerText = "حسناً";
        }

        modal.classList.add('show');

        btnYes.onclick = () => { modal.classList.remove('show'); resolve(true); };
        btnNo.onclick = () => { modal.classList.remove('show'); resolve(false); };
    });
}

// --------------------------------------------------------
// التحكم بفتح وإغلاق تبويبة الإعدادات الخلفية
// --------------------------------------------------------
const settingsOverlay = document.getElementById('settingsOverlay');
document.getElementById('settingsBtn').addEventListener('click', () => {
    settingsOverlay.classList.add('show');
});
document.getElementById('closeSettingsBtn').addEventListener('click', () => {
    settingsOverlay.classList.remove('show');
});

// تفعيل اختيار الخلفيات وتطبيقها على كامل الشاشة تلقائياً
document.querySelectorAll('.bg-option').forEach(option => {
    option.addEventListener('click', function() {
        const bgUrl = this.getAttribute('data-bg');
        document.querySelectorAll('.bg-option').forEach(el => el.classList.remove('selected'));
        this.classList.add('selected');
        
        if (bgUrl === 'none') {
            appContainer.style.backgroundImage = 'none';
            localStorage.setItem('room-wallpaper', 'none');
        } else {
            appContainer.style.backgroundImage = `url('${bgUrl}')`;
            localStorage.setItem('room-wallpaper', bgUrl);
        }
    });
});

// --------------------------------------------------------
// إعداد محرك الصوت (PeerJS & TURN Servers لشبكات الـ 4G)
// --------------------------------------------------------
const peer = new Peer({
    config: {
        'iceServers': [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
            { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
            { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
        ]
    },
    debug: 0
});

peer.on('open', (id) => {
    myPeerId = id;
    document.getElementById('statusText').innerText = `متصل كـ: ${myName}`;
});

peer.on('disconnected', () => { peer.reconnect(); });
peer.on('error', (err) => { if(err.type === 'network') peer.reconnect(); });

peer.on('connection', (conn) => {
    conn.on('data', (data) => {
        if (data === 'CALL_ME_BRO' && localStream) peer.call(conn.peer, localStream);
    });
});

peer.on('call', (call) => {
    call.answer(); 
    call.on('stream', (remoteStream) => {
        for (let i = 0; i < 4; i++) {
            if (globalMicsData[i] && globalMicsData[i].peerId === call.peer) {
                const audioElement = document.getElementById(`audio-${i}`);
                audioElement.srcObject = remoteStream;
                audioElement.play().catch(()=>{});
                break;
            }
        }
    });
});

// --------------------------------------------------------
// إدارة التيجان الذهبية ومزامنة المايكات مع Firebase
// --------------------------------------------------------
onValue(micsRef, (snapshot) => {
    globalMicsData = snapshot.val() || {};
    
    for (let i = 0; i < 4; i++) {
        const slotData = globalMicsData[i];
        const slotElement = document.getElementById(`slot-${i}`);
        const nameElement = document.getElementById(`name-${i}`);
        const audioElement = document.getElementById(`audio-${i}`);

        if (slotData) {
            slotElement.classList.add('active');
            nameElement.innerText = slotData.name;

            if (slotData.peerId !== myPeerId && !activeConnections[i]) {
                if(!peer.disconnected) {
                    const conn = peer.connect(slotData.peerId);
                    activeConnections[i] = conn;
                    conn.on('open', () => conn.send('CALL_ME_BRO'));
                }
            }
        } else {
            slotElement.classList.remove('active');
            nameElement.innerText = "فارغ";
            
            if (activeConnections[i]) {
                activeConnections[i].close();
                delete activeConnections[i];
                audioElement.srcObject = null;
            }
            if (myCurrentMicIndex === i) {
                myCurrentMicIndex = -1;
                stopMyMic();
            }
        }
    }
});

// النقر على منصة التاج الذهبي
document.querySelectorAll('.mic-slot').forEach(slot => {
    slot.addEventListener('click', async function() {
        const index = parseInt(this.getAttribute('data-index'));

        if (myCurrentMicIndex === index) {
            const wantToLeave = await showCustomModal("نزول", "هل تريد النزول من المنصة المايك؟", true);
            if (wantToLeave) {
                const micRef = ref(db, `room-mics/${index}`);
                remove(micRef); 
                onDisconnect(micRef).cancel(); 
                stopMyMic();
                myCurrentMicIndex = -1;
            }
            return;
        }

        if (myCurrentMicIndex !== -1) {
            showCustomModal("عذراً", "أنت متواجد على تاج آخر بالفعل! انزل أولاً.");
            return;
        }

        if (this.classList.contains('active')) {
            showCustomModal("عذراً", "هذا المكان محجوز لشخص آخر.");
            return;
        }

        const wantToJoin = await showCustomModal("صعود والمنصة", "هل تريد الصعود للمايك والتحدث؟", true);
        if (wantToJoin) {
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                myCurrentMicIndex = index;
                const micRef = ref(db, `room-mics/${index}`);
                onDisconnect(micRef).remove();
                set(micRef, { name: myName, peerId: myPeerId });
            } catch (err) {
                showCustomModal("خطأ", "يجب إعطاء صلاحية الميكروفون للهاتف للصعود.");
            }
        }
    });
});

function stopMyMic() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
}

// --------------------------------------------------------
// نظام الدردشة النصية اللحظية
// --------------------------------------------------------
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const chatArea = document.getElementById('chatArea');

function sendMessage() {
    const text = chatInput.value.trim();
    if (text === "") return;
    push(messagesRef, { sender: myName, text: text, timestamp: Date.now() });
    chatInput.value = "";
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });

onChildAdded(messagesRef, (snapshot) => {
    const data = snapshot.val();
    const messageDiv = document.createElement('div');
    if (data.sender === myName) {
        messageDiv.className = 'message mine';
        messageDiv.innerHTML = `<div class="msg-bubble">${data.text}</div>`;
    } else {
        messageDiv.className = 'message';
        messageDiv.innerHTML = `<div class="msg-sender">${data.sender}</div><div class="msg-bubble">${data.text}</div>`;
    }
    chatArea.appendChild(messageDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
});
