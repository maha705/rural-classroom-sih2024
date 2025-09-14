const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../client')));

// Store connected users
const users = {};
const classrooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join classroom
  socket.on('join-classroom', (data) => {
    const { classroomId, userType, userName } = data;
    
    socket.join(classroomId);
    users[socket.id] = { classroomId, userType, userName };
    
    if (!classrooms[classroomId]) {
      classrooms[classroomId] = { teacher: null, students: [] };
    }
    
    if (userType === 'teacher') {
      classrooms[classroomId].teacher = socket.id;
    } else {
      classrooms[classroomId].students.push(socket.id);
    }
    
    // Notify others in classroom
    socket.to(classroomId).emit('user-joined', {
      userId: socket.id,
      userType,
      userName
    });
    
    // Send current classroom state to new user
    socket.emit('classroom-state', classrooms[classroomId]);
  });

  // WebRTC signaling
  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      offer: data.offer,
      sender: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      answer: data.answer,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (users[socket.id]) {
      const { classroomId } = users[socket.id];
      socket.to(classroomId).emit('user-left', socket.id);
      
      // Clean up classroom data
      if (classrooms[classroomId]) {
        if (classrooms[classroomId].teacher === socket.id) {
          classrooms[classroomId].teacher = null;
        } else {
          classrooms[classroomId].students = 
            classrooms[classroomId].students.filter(id => id !== socket.id);
        }
      }
    }
    
    delete users[socket.id];
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/teacher.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/teacher.html'));
});

app.get('/student.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/student.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`Local access: http://localhost:${PORT}`);
  }
});
