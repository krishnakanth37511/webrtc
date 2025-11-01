import './style.css';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dpdrqnsxrtxmoqzjfugo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHJxbnN4cnR4bW9xempmdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE4NjQyNDEsImV4cCI6MjA3NzQ0MDI0MX0.FxgiBEjnVPCTaBc4v2y__jVSTl_KBRI7fiVQ9yl9ogE';
const supabase = createClient(supabaseUrl, supabaseKey);

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
    // Optional TURN server for mobile-to-PC connections across networks
    // { urls: 'turn:TURN_SERVER_URL', username: 'user', credential: 'pass' }
  ],
  iceCandidatePoolSize: 10,
};

// Global state
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// Helper: random ID
const genId = () => Math.random().toString(36).substring(2, 10);

// 2. Create an offer
callButton.onclick = async () => {
  const callId = genId();
  callInput.value = callId;

  await supabase.from('calls').insert([{ id: callId }]);

  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  await supabase.from('calls').update({ offer: offerDescription.toJSON() }).eq('id', callId);

  // ICE candidates for caller
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await supabase.from('candidates').insert([{ call_id: callId, role: 'offer', candidate: event.candidate.toJSON() }]);
    }
  };

  // Listen for answer SDP
  const answerSub = supabase
    .from(`calls:id=eq.${callId}`)
    .on('UPDATE', payload => {
      const data = payload.new;
      if (data.answer && !pc.currentRemoteDescription) {
        pc.setRemoteDescription(data.answer);
      }
    })
    .subscribe();

  // Listen for answer ICE candidates
  const iceSub = supabase
    .from(`candidates:call_id=eq.${callId}`)
    .on('INSERT', payload => {
      if (payload.new.role === 'answer') {
        pc.addIceCandidate(new RTCIceCandidate(payload.new.candidate));
      }
    })
    .subscribe();

  hangupButton.disabled = false;
};

// 3. Answer the call
answerButton.onclick = async () => {
  const callId = callInput.value;
  const { data: callData } = await supabase.from('calls').select('*').eq('id', callId).single();

  await pc.setRemoteDescription(callData.offer);

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  await supabase.from('calls').update({ answer: answerDescription.toJSON() }).eq('id', callId);

  // ICE candidates for answerer
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await supabase.from('candidates').insert([{ call_id: callId, role: 'answer', candidate: event.candidate.toJSON() }]);
    }
  };

  // Listen for offer ICE candidates
  supabase
    .from(`candidates:call_id=eq.${callId}`)
    .on('INSERT', payload => {
      if (payload.new.role === 'offer') {
        pc.addIceCandidate(new RTCIceCandidate(payload.new.candidate));
      }
    })
    .subscribe();
};
