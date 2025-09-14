let socket;
let localStream;
let remoteStreams = {};
let peerConnections = {};
let userType;
let userName;
let classroomId;
let isVideoEnabled = true;
let isAudioEnabled = true;
let isClassActive = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 25px;
        border-radius: 10px;
        color: white;
        font-weight: bold;
        z-index: 1000;
        animation: slideIn 0.3s ease;
        background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4CAF50' : '#2196F3'};
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
    `;
    
    document.body.appendChild(messageDiv);
    setTimeout(() => messageDiv.remove(), 3000);
}

function updateStatus(elementId, status, type = 'info') {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = status;
        element.className = `value ${type}`;
    }
}

function updateStudentCount() {
    const count = Object.keys(remoteStreams).length;
    const studentCountElements = document.querySelectorAll('#studentCount');
    studentCountElements.forEach(element => {
        element.textContent = count;
    });
}

function initializeSocket() {
    socket = io();
    
    socket.on('connect', () => {
        console.log('Connected to server:', socket.id);
        showMessage('Connected to server', 'success');
        updateStatus('connectionStatus', 'Connected', 'success');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showMessage('Disconnected from server', 'error');
        updateStatus('connectionStatus', 'Disconnected', 'error');
    });
    
    socket.on('user-joined', handleUserJoined);
    socket.on('user-left', handleUserLeft);
    socket.on('offer', handleOffer);
    socket.on('answer', handleAnswer);
    socket.on('ice-candidate', handleIceCandidate);
    socket.on('classroom-state', handleClassroomState);
}

async function getUserMedia(constraints = { video: true, audio: true }) {
    try {
        console.log('Requesting user media...');
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('Got user media successfully');
        showMessage('Camera and microphone access granted', 'success');
        
        const videoElement = document.getElementById(userType + 'Video');
        if (videoElement) {
            videoElement.srcObject = localStream;
            videoElement.play();
        }
        
        updateControlButtons();
        return localStream;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        
        let errorMessage = 'Unable to access camera and microphone. ';
        if (error.name === 'NotAllowedError') {
            errorMessage += 'Please allow camera and microphone permissions.';
        } else if (error.name === 'NotFoundError') {
            errorMessage += 'No camera or microphone found.';
        } else {
            errorMessage += 'Please check your devices and try again.';
        }
        
        showMessage(errorMessage, 'error');
        throw error;
    }
}

function updateControlButtons() {
    const toggleVideoBtn = document.getElementById('toggleVideo');
    const toggleAudioBtn = document.getElementById('toggleAudio');
    
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];
        
        if (toggleVideoBtn && videoTrack) {
            isVideoEnabled = videoTrack.enabled;
            toggleVideoBtn.textContent = isVideoEnabled ? '📹' : '📹❌';
            toggleVideoBtn.style.background = isVideoEnabled ? 'rgba(76, 175, 80, 0.8)' : 'rgba(244, 67, 54, 0.8)';
        }
        
        if (toggleAudioBtn && audioTrack) {
            isAudioEnabled = audioTrack.enabled;
            toggleAudioBtn.textContent = isAudioEnabled ? '🎤' : '🎤❌';
            toggleAudioBtn.style.background = isAudioEnabled ? 'rgba(76, 175, 80, 0.8)' : 'rgba(244, 67, 54, 0.8)';
        }
    }
}

function createPeerConnection(targetUserId) {
    console.log('Creating peer connection for:', targetUserId);
    
    const peerConnection = new RTCPeerConnection(configuration);
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log('Adding track:', track.kind);
            peerConnection.addTrack(track, localStream);
        });
    }
    
    peerConnection.ontrack = (event) => {
        console.log('Received remote stream from:', targetUserId);
        remoteStreams[targetUserId] = event.streams[0];
        displayRemoteStream(targetUserId, event.streams[0]);
        updateStudentCount();
    };
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('Sending ICE candidate to:', targetUserId);
            socket.emit('ice-candidate', {
                target: targetUserId,
                candidate: event.candidate
            });
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection with ${targetUserId}:`, peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'connected') {
            showMessage('Connected to user', 'success');
        } else if (peerConnection.connectionState === 'failed') {
            showMessage('Connection failed with user', 'error');
        }
    };
    
    peerConnections[targetUserId] = peerConnection;
    return peerConnection;
}

async function handleUserJoined(data) {
    console.log('User joined:', data);
    showMessage(`${data.userName || 'User'} joined the class`, 'success');
    
    if (userType === 'teacher' && data.userType === 'student') {
        try {
            const peerConnection = createPeerConnection(data.userId);
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(offer);
            
            console.log('Sending offer to student:', data.userId);
            socket.emit('offer', {
                target: data.userId,
                offer: offer
            });
        } catch (error) {
            console.error('Error creating offer:', error);
            showMessage('Error connecting to student', 'error');
        }
    }
    
    updateStudentCount();
}

async function handleUserLeft(userId) {
    console.log('User left:', userId);
    showMessage('A user left the class', 'info');
    
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
    }
    
    if (remoteStreams[userId]) {
        delete remoteStreams[userId];
    }
    
    removeVideoElement(userId);
    updateStudentCount();
}

async function handleOffer(data) {
    console.log('Received offer from:', data.sender);
    
    try {
        const peerConnection = createPeerConnection(data.sender);
        await peerConnection.setRemoteDescription(data.offer);
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        console.log('Sending answer to:', data.sender);
        socket.emit('answer', {
            target: data.sender,
            answer: answer
        });
    } catch (error) {
        console.error('Error handling offer:', error);
        showMessage('Error connecting to teacher', 'error');
    }
}

async function handleAnswer(data) {
    console.log('Received answer from:', data.sender);
    
    try {
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            await peerConnection.setRemoteDescription(data.answer);
            console.log('Answer processed successfully');
        }
    } catch (error) {
        console.error('Error handling answer:', error);
        showMessage('Error establishing connection', 'error');
    }
}

async function handleIceCandidate(data) {
    console.log('Received ICE candidate from:', data.sender);
    
    try {
        const peerConnection = peerConnections[data.sender];
        if (peerConnection) {
            await peerConnection.addIceCandidate(data.candidate);
        }
    } catch (error) {
        console.error('Error adding ICE candidate:', error);
    }
}

function handleClassroomState(state) {
    console.log('Classroom state updated:', state);
    updateStudentCount();
}

function displayRemoteStream(userId, stream) {
    if (userType === 'student') {
        const teacherVideo = document.getElementById('teacherVideo');
        if (teacherVideo && !teacherVideo.srcObject) {
            teacherVideo.srcObject = stream;
            teacherVideo.play();
            
            const indicator = document.getElementById('teacherConnectionStatus');
            if (indicator) {
                indicator.textContent = 'Connected';
                indicator.style.color = '#4CAF50';
            }
        }
    } else if (userType === 'teacher') {
        addStudentVideo(userId, stream);
    }
}

function addStudentVideo(studentId, stream) {
    const studentVideos = document.getElementById('studentVideos');
    if (!studentVideos) return;
    
    const waitingMessage = studentVideos.querySelector('.waiting-message');
    if (waitingMessage) {
        waitingMessage.remove();
    }
    
    if (document.getElementById('video-' + studentId)) {
        return;
    }
    
    const videoContainer = document.createElement('div');
    videoContainer.className = 'video-container student-video';
    videoContainer.id = 'video-' + studentId;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.srcObject = stream;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = 'Student';
    
    videoContainer.appendChild(video);
    videoContainer.appendChild(label);
    studentVideos.appendChild(videoContainer);
    
    console.log('Added student video:', studentId);
}

function removeVideoElement(userId) {
    const videoElement = document.getElementById('video-' + userId);
    if (videoElement) {
        videoElement.remove();
        console.log('Removed video element:', userId);
    }
    
    if (userType === 'teacher') {
        const studentVideos = document.getElementById('studentVideos');
        if (studentVideos && studentVideos.children.length === 0) {
            studentVideos.innerHTML = `
                <div class="waiting-message">
                    <h3>Waiting for students to join...</h3>
                    <p>Share your Classroom ID with students</p>
                </div>
            `;
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            isVideoEnabled = videoTrack.enabled;
            
            showMessage(
                isVideoEnabled ? 'Camera turned on' : 'Camera turned off',
                isVideoEnabled ? 'success' : 'info'
            );
            
            updateControlButtons();
        }
    }
}

function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            isAudioEnabled = audioTrack.enabled;
            
            showMessage(
                isAudioEnabled ? 'Microphone turned on' : 'Microphone turned off',
                isAudioEnabled ? 'success' : 'info'
            );
            
            updateControlButtons();
        }
    }
}

function raiseHand() {
    showMessage('Hand raised!', 'info');
}

async function startClass() {
    const nameInput = document.getElementById('teacherName');
    const classIdInput = document.getElementById('classroomId');
    
    userName = nameInput.value.trim();
    classroomId = classIdInput.value.trim();
    
    if (!userName || !classroomId) {
        showMessage('Please enter your name and classroom ID', 'error');
        return;
    }
    
    try {
        const startBtn = document.getElementById('startClass');
        const endBtn = document.getElementById('endClass');
        
        startBtn.textContent = 'Starting...';
        startBtn.disabled = true;
        
        await getUserMedia();
        
        socket.emit('join-classroom', {
            classroomId,
            userType: 'teacher',
            userName
        });
        
        startBtn.style.display = 'none';
        endBtn.style.display = 'inline-block';
        
        updateStatus('classStatus', 'Class Started', 'success');
        updateStatus('displayClassroomId', classroomId, 'info');
        
        nameInput.disabled = true;
        classIdInput.disabled = true;
        
        isClassActive = true;
        showMessage(`Class "${classroomId}" started successfully!`, 'success');
        
    } catch (error) {
        console.error('Error starting class:', error);
        showMessage('Failed to start class. Please check camera/microphone access.', 'error');
        
        const startBtn = document.getElementById('startClass');
        startBtn.textContent = 'Start Class';
        startBtn.disabled = false;
    }
}

async function joinClass() {
    const nameInput = document.getElementById('studentName');
    const classIdInput = document.getElementById('classroomId');
    
    userName = nameInput.value.trim();
    classroomId = classIdInput.value.trim();
    
    if (!userName || !classroomId) {
        showMessage('Please enter your name and classroom ID', 'error');
        return;
    }
    
    try {
        const joinBtn = document.getElementById('joinClass');
        const leaveBtn = document.getElementById('leaveClass');
        
        joinBtn.textContent = 'Joining...';
        joinBtn.disabled = true;
        
        await getUserMedia();
        
        socket.emit('join-classroom', {
            classroomId,
            userType: 'student',
            userName
        });
        
        joinBtn.style.display = 'none';
        leaveBtn.style.display = 'inline-block';
        
        updateStatus('connectionStatus', 'Connected', 'success');
        updateStatus('displayClassroomId', classroomId, 'info');
        
        nameInput.disabled = true;
        classIdInput.disabled = true;
        
        isClassActive = true;
        showMessage(`Joined class "${classroomId}" successfully!`, 'success');
        
    } catch (error) {
        console.error('Error joining class:', error);
        showMessage('Failed to join class. Please check camera/microphone access.', 'error');
        
        const joinBtn = document.getElementById('joinClass');
        joinBtn.textContent = 'Join Class';
        joinBtn.disabled = false;
    }
}

function endClass() {
    if (confirm('Are you sure you want to end the class?')) {
        cleanup();
        showMessage('Class ended', 'info');
        window.location.reload();
    }
}

function leaveClass() {
    if (confirm('Are you sure you want to leave the class?')) {
        cleanup();
        showMessage('Left class', 'info');
        window.location.reload();
    }
}

function cleanup() {
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop();
        });
        localStream = null;
    }
    
    Object.values(peerConnections).forEach(pc => {
        pc.close();
    });
    peerConnections = {};
    remoteStreams = {};
    
    if (socket) {
        socket.disconnect();
    }
    
    isClassActive = false;
}

function initializeTeacher() {
    console.log('Initializing teacher interface...');
    
    const startBtn = document.getElementById('startClass');
    const endBtn = document.getElementById('endClass');
    const toggleVideoBtn = document.getElementById('toggleVideo');
    const toggleAudioBtn = document.getElementById('toggleAudio');
    const shareScreenBtn = document.getElementById('shareScreen');
    
    if (startBtn) startBtn.addEventListener('click', startClass);
    if (endBtn) endBtn.addEventListener('click', endClass);
    if (toggleVideoBtn) toggleVideoBtn.addEventListener('click', toggleVideo);
    if (toggleAudioBtn) toggleAudioBtn.addEventListener('click', toggleAudio);
    if (shareScreenBtn) shareScreenBtn.addEventListener('click', () => {
        showMessage('Screen sharing coming soon!', 'info');
    });
    
    const inputs = document.querySelectorAll('#teacherName, #classroomId');
    inputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !isClassActive) {
                startClass();
            }
        });
    });
}

function initializeStudent() {
    console.log('Initializing student interface...');
    
    const joinBtn = document.getElementById('joinClass');
    const leaveBtn = document.getElementById('leaveClass');
    const toggleVideoBtn = document.getElementById('toggleVideo');
    const toggleAudioBtn = document.getElementById('toggleAudio');
    const raiseHandBtn = document.getElementById('raiseHand');
    
    if (joinBtn) joinBtn.addEventListener('click', joinClass);
    if (leaveBtn) leaveBtn.addEventListener('click', leaveClass);
    if (toggleVideoBtn) toggleVideoBtn.addEventListener('click', toggleVideo);
    if (toggleAudioBtn) toggleAudioBtn.addEventListener('click', toggleAudio);
    if (raiseHandBtn) raiseHandBtn.addEventListener('click', raiseHand);
    
    const inputs = document.querySelectorAll('#studentName, #classroomId');
    inputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !isClassActive) {
                joinClass();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing application...');
    
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .message { transition: all 0.3s ease; }
        .value.success { color: #4CAF50; }
        .value.error { color: #f44336; }
        .value.info { color: #2196F3; }
    `;
    document.head.appendChild(style);
    
    initializeSocket();
    
    const path = window.location.pathname;
    
    if (path.includes('teacher.html') || path.endsWith('teacher')) {
        userType = 'teacher';
        initializeTeacher();
    } else if (path.includes('student.html') || path.endsWith('student')) {
        userType = 'student';
        initializeStudent();
    }
    
    console.log('Application initialized as:', userType);
});

window.addEventListener('beforeunload', () => {
    cleanup();
});

window.addEventListener('error', (event) => {
    console.error('JavaScript error:', event.error);
    showMessage('An error occurred. Please refresh the page.', 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showMessage('Connection error occurred', 'error');
});

console.log('script.js loaded successfully');
