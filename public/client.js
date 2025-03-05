// client.js

// Retrieve stored username from localStorage (or create a new one if not present)
let storedName = localStorage.getItem('username');
if (!storedName) {
  storedName = "CuteUser-" + Math.floor(Math.random() * 1000);
  localStorage.setItem('username', storedName);
}

// Pre-fill username input
document.getElementById('username-input').value = storedName;

const socket = io({ query: { username: storedName } });

// On reconnect, re‑emit the stored username so it remains persistent.
socket.on('reconnect', () => {
  const username = localStorage.getItem('username');
  if (username) {
    socket.emit('setUsername', username);
  }
});

let currentChatUser = null;  // The user ID you’re chatting with
let currentChatName = "";
let chatHistory = {};        // { userId: [messageObj, ...] }
let localPeer = null;
let currentCallSocketId = null;
let localStream = null;

let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// DOM Elements
const usersList = document.getElementById('users-list');
const chatWindow = document.getElementById('chat-window');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const usernameInput = document.getElementById('username-input');
const setUsernameBtn = document.getElementById('set-username');
const chatWithHeader = document.getElementById('chat-with');
const mediaInput = document.getElementById('media-input');
const sendMediaBtn = document.getElementById('send-media');
const recordAudioBtn = document.getElementById('record-audio');
const callUserBtn = document.getElementById('call-user');
const uploadProgress = document.getElementById('upload-progress');
const progressBar = uploadProgress.querySelector('.progress-bar');

// Set custom username and store it
setUsernameBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  if (name) {
    localStorage.setItem('username', name);
    socket.emit('setUsername', name);
  }
});

// Update user list in the sidebar
socket.on('users', (users) => {
  usersList.innerHTML = '';
  users.forEach(user => {
    if (user.id === socket.id) return; // Skip yourself
    const li = document.createElement('li');
    li.className = 'list-group-item list-group-item-action';
    li.textContent = user.name;
    li.dataset.id = user.id;
    li.addEventListener('click', () => {
      currentChatUser = user.id;
      currentChatName = user.name;
      chatWithHeader.textContent = `Chat with ${user.name}`;
      loadChatHistory(user.id);
    });
    usersList.appendChild(li);
  });
});

// Load chat history for the selected user
function loadChatHistory(userId) {
  chatWindow.innerHTML = '';
  if (chatHistory[userId]) {
    chatHistory[userId].forEach(msg => {
      appendMessage(msg);
    });
  }
}

// Append a message bubble to the chat window
function appendMessage(msg) {
  const msgDiv = document.createElement('div');
  msgDiv.className = msg.self ? 'message self' : 'message';
  
  // If it's a media message, render it accordingly
  if (msg.type) {
    if (msg.type === 'image') {
      const img = document.createElement('img');
      img.src = msg.content;
      img.style.maxWidth = '200px';
      msgDiv.appendChild(img);
    } else if (msg.type === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = msg.content;
      msgDiv.appendChild(audio);
    } else {
      // Fallback for file type or unknown type
      msgDiv.textContent = `[Sent ${msg.type}]`;
    }
  } else {
    msgDiv.innerHTML = `<strong>${msg.fromName}</strong>: ${msg.text}`;
  }
  chatWindow.appendChild(msgDiv);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Send a private text message
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!currentChatUser) {
    alert("Select a user to chat with.");
    return;
  }
  const text = messageInput.value.trim();
  if (text) {
    socket.emit('privateMessage', { to: currentChatUser, message: text });
    const msg = { from: socket.id, fromName: "Me", text: text, self: true };
    if (!chatHistory[currentChatUser]) chatHistory[currentChatUser] = [];
    chatHistory[currentChatUser].push(msg);
    appendMessage(msg);
    messageInput.value = '';
  }
});

// Receive a private text message
socket.on('privateMessage', (data) => {
  let senderName = (data.from === currentChatUser) ? currentChatName : data.from;
  const msg = { from: data.from, fromName: senderName, text: data.message, self: data.self || false };
  if (!chatHistory[data.from]) chatHistory[data.from] = [];
  chatHistory[data.from].push(msg);
  if (data.from === currentChatUser) {
    appendMessage(msg);
  }
});

// Send a file (image/audio) with progress feedback
sendMediaBtn.addEventListener('click', () => {
  if (!currentChatUser) {
    alert("Select a user to send a file.");
    return;
  }
  const file = mediaInput.files[0];
  if (file) {
    const reader = new FileReader();
    uploadProgress.style.display = 'block';
    reader.onprogress = function (event) {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        progressBar.style.width = percent + '%';
        progressBar.setAttribute('aria-valuenow', percent);
      }
    };
    reader.onload = function (e) {
      uploadProgress.style.display = 'none';
      progressBar.style.width = '0%';
      let type = file.type.startsWith('image')
        ? 'image'
        : file.type.startsWith('audio')
          ? 'audio'
          : 'file';
      socket.emit('privateMedia', { to: currentChatUser, type: type, content: e.target.result });
      const msg = { from: socket.id, fromName: "Me", type: type, content: e.target.result, self: true };
      if (!chatHistory[currentChatUser]) chatHistory[currentChatUser] = [];
      chatHistory[currentChatUser].push(msg);
      appendMessage(msg);
    };
    reader.onerror = function (error) {
      console.error("Error reading file:", error);
      uploadProgress.style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
});

// Receive media messages and render images/audio when appropriate
socket.on('privateMedia', (data) => {
  const msg = { 
    from: data.from, 
    fromName: (data.from === currentChatUser) ? currentChatName : data.from, 
    type: data.type, 
    content: data.content, 
    self: data.self || false 
  };
  if (!chatHistory[data.from]) chatHistory[data.from] = [];
  chatHistory[data.from].push(msg);
  if (data.from === currentChatUser) {
    appendMessage(msg);
  }
});

// Record and send an audio message using MediaRecorder
recordAudioBtn.addEventListener('click', async () => {
  if (!currentChatUser) {
    alert("Select a user to send audio.");
    return;
  }
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.start();
      isRecording = true;
      recordAudioBtn.textContent = "Stop Recording";
      mediaRecorder.addEventListener("dataavailable", (event) => {
        audioChunks.push(event.data);
      });
      mediaRecorder.addEventListener("stop", () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = function (e) {
          socket.emit('privateMedia', { to: currentChatUser, type: 'audio', content: e.target.result });
          const msg = { from: socket.id, fromName: "Me", type: 'audio', content: e.target.result, self: true };
          if (!chatHistory[currentChatUser]) chatHistory[currentChatUser] = [];
          chatHistory[currentChatUser].push(msg);
          appendMessage(msg);
        };
        reader.readAsDataURL(audioBlob);
        isRecording = false;
        recordAudioBtn.textContent = "Record Audio";
      });
      mediaRecorder.addEventListener("error", (event) => {
        console.error("MediaRecorder error:", event.error);
        alert("Error recording audio: " + event.error.message);
        isRecording = false;
        recordAudioBtn.textContent = "Record Audio";
      });
    } catch (err) {
      console.error("Audio recording error:", err);
      alert("Error accessing microphone. Remember: getUserMedia requires HTTPS (or localhost).");
    }
  } else {
    mediaRecorder.stop();
  }
});

// Initiate a call using SimplePeer with a media stream
callUserBtn.addEventListener('click', async () => {
  if (!currentChatUser) {
    alert("Select a user to call.");
    return;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    console.error("Error accessing media devices for call:", err);
    alert("Error accessing camera/microphone. Remember: getUserMedia requires HTTPS (or localhost).");
    return;
  }
  initiateCall(currentChatUser, localStream);
});

function initiateCall(targetId, stream) {
  if (localPeer) {
    localPeer.destroy();
    localPeer = null;
  }
  currentCallSocketId = targetId;
  localPeer = new SimplePeer({
    initiator: true,
    trickle: false,
    stream: stream,
    config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
  });

  localPeer.on('signal', (signalData) => {
    socket.emit('signal', { to: targetId, signal: signalData });
  });

  localPeer.on('connect', () => {
    console.log('Call connected with ' + targetId);
    var callModal = new bootstrap.Modal(document.getElementById('callModal'));
    callModal.show();
  });

  localPeer.on('stream', (remoteStream) => {
    const videoElem = document.getElementById('call-video');
    videoElem.srcObject = remoteStream;
    videoElem.play();
  });

  localPeer.on('error', (err) => {
    console.error('Peer error:', err);
  });
}

// Handle incoming WebRTC signaling messages
socket.on('signal', async (data) => {
  if (!localPeer) {
    currentCallSocketId = data.from;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.error("Error accessing media devices for incoming call:", err);
      alert("Error accessing camera/microphone. Remember: getUserMedia requires HTTPS (or localhost).");
      return;
    }
    localPeer = new SimplePeer({
      initiator: false,
      trickle: false,
      stream: localStream,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
    });
    localPeer.on('signal', (signalData) => {
      socket.emit('signal', { to: data.from, signal: signalData });
    });
    localPeer.on('connect', () => {
      console.log('Call connected with ' + data.from);
      var callModal = new bootstrap.Modal(document.getElementById('callModal'));
      callModal.show();
    });
    localPeer.on('stream', (remoteStream) => {
      const videoElem = document.getElementById('call-video');
      videoElem.srcObject = remoteStream;
      videoElem.play();
    });
    localPeer.on('error', (err) => {
      console.error('Peer error:', err);
    });
  }
  localPeer.signal(data.signal);
});
