// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
// Increase max payload size to 100MB to help prevent disconnects on file send.
const io = require('socket.io')(http, { maxHttpBufferSize: 1e8 });

const PORT = process.env.PORT || 3000;
let users = {};

// Serve static files from the public folder
app.use(express.static('public'));

// List of cute names for new users (fallback if no username provided)
const cuteNames = ["Fluffy", "Bunny", "Cupcake", "Peaches", "Sparkle", "Cuddles", "Bubbles", "Sunny"];

io.on('connection', (socket) => {
  console.log('New connection: ' + socket.id);

  // Use the username from the query (if provided) or assign a random cute name.
  let username = socket.handshake.query.username;
  if (!username || username.trim().length === 0) {
    username = cuteNames[Math.floor(Math.random() * cuteNames.length)] + "-" + socket.id.substring(0, 4);
  }
  users[socket.id] = { id: socket.id, name: username };

  // Broadcast the updated users list
  io.emit('users', Object.values(users));

  // Allow the client to update their username
  socket.on('setUsername', (name) => {
    if (name && name.trim().length > 0) {
      users[socket.id].name = name.trim();
      io.emit('users', Object.values(users));
    }
  });

  // Private text message (one-on-one)
  socket.on('privateMessage', (data) => {
    socket.to(data.to).emit('privateMessage', { from: socket.id, message: data.message });
    socket.emit('privateMessage', { from: socket.id, message: data.message, self: true });
  });

  // Private media messages (image/audio)
  socket.on('privateMedia', (data) => {
    socket.to(data.to).emit('privateMedia', { from: socket.id, type: data.type, content: data.content });
    socket.emit('privateMedia', { from: socket.id, type: data.type, content: data.content, self: true });
  });

  // Relay WebRTC signaling data for private calls
  socket.on('signal', (data) => {
    io.to(data.to).emit('signal', { from: socket.id, signal: data.signal });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected: ' + socket.id);
    delete users[socket.id];
    io.emit('users', Object.values(users));
  });
});

http.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
