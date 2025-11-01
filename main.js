import './style.css';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dpdrqnsxrtxmoqzjfugo.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwZHJxbnN4cnR4bW9xempmdWdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE4NjQyNDEsImV4cCI6MjA3NzQ0MDI0MX0.FxgiBEjnVPCTaBc4v2y__jVSTl_KBRI7fiVQ9yl9ogE';
const supabase = createClient(supabaseUrl, supabaseKey);

const servers = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
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

  // Create call entry
  await supabase.from('calls').insert([{ id: callId }]);

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = { sdp: offerDescription.sdp, type: offerDescription.type };
  await supabase.from('calls').update({ offer }).eq('id', callId);

  // Save ICE candidates
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await supabase.from('candidates').insert([
        { call_id: callId, role: 'offer', candidate: event.candidate.toJSON() },
      ]);
    }
  };

  // Listen for answer
  supabase
    .channel('answer-' + callId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `id=eq.${callId}` },
      async (payload) => {
        const data = payload.new;
        if (data.answer && !pc.currentRemoteDescription) {
          const answerDescription = new RTCSessionDescription(data.answer);
          await pc.setRemoteDescription(answerDescription);
        }
      })
    .subscribe();

  // Listen for answer ICE candidates
  supabase
    .channel('answer-candidates-' + callId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'candidates',
      filter: `call_id=eq.${callId},role=eq.answer`,
    }, async (payload) => {
      const candidate = new RTCIceCandidate(payload.new.candidate);
      await pc.addIceCandidate(candidate);
    })
    .subscribe();

  hangupButton.disabled = false;
};

// 3. Answer the call
answerButton.onclick = async () => {
  const callId = callInput.value;
  const { data: callData } = await supabase.from('calls').select('*').eq('id', callId).single();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = { type: answerDescription.type, sdp: answerDescription.sdp };
  await supabase.from('calls').update({ answer }).eq('id', callId);

  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      await supabase.from('candidates').insert([
        { call_id: callId, role: 'answer', candidate: event.candidate.toJSON() },
      ]);
    }
  };

  // Listen for offer ICE candidates
  supabase
    .channel('offer-candidates-' + callId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'candidates',
      filter: `call_id=eq.${callId},role=eq.offer`,
    }, async (payload) => {
      const candidate = new RTCIceCandidate(payload.new.candidate);
      await pc.addIceCandidate(candidate);
    })
    .subscribe();
};
