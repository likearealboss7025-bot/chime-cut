const input = document.querySelector('#audio-file');
const dropZone = document.querySelector('#drop-zone');
const workspace = document.querySelector('#workspace');
const startSlider = document.querySelector('#clip-start');
const lengthSlider = document.querySelector('#clip-length');
const startDisplay = document.querySelector('#start-display');
const lengthDisplay = document.querySelector('#length-display');
const durationLabel = document.querySelector('#duration-label');
const fileName = document.querySelector('#file-name');
const canvas = document.querySelector('#waveform');
const ctx = canvas.getContext('2d');
const status = document.querySelector('#status');
const previewButton = document.querySelector('#preview');
const downloadButton = document.querySelector('#download');
const startOver = document.querySelector('#start-over');
const fadeIn = document.querySelector('#fade-in');
const fadeOut = document.querySelector('#fade-out');

let audioContext;
let buffer;
let selectedName = 'my-chime';
let currentSource;

function time(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function selectedLength() { return Number(lengthSlider.value); }
function selectedStart() { return Number(startSlider.value); }

function refreshControls() {
  if (!buffer) return;
  const maxStart = Math.max(0, buffer.duration - selectedLength());
  startSlider.max = maxStart;
  if (selectedStart() > maxStart) startSlider.value = maxStart;
  const actualLength = Math.min(selectedLength(), buffer.duration - selectedStart());
  lengthSlider.value = actualLength;
  startDisplay.textContent = time(selectedStart());
  lengthDisplay.textContent = time(actualLength);
  drawWaveform();
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const box = canvas.getBoundingClientRect();
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawWaveform() {
  if (!buffer) return;
  resizeCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  const data = buffer.getChannelData(0);
  const samplesPerBar = Math.max(1, Math.floor(data.length / width));
  ctx.fillStyle = '#b29ce8';
  for (let x = 0; x < width; x += 2) {
    let min = 1, max = -1;
    const first = Math.floor(x * samplesPerBar);
    for (let i = first; i < first + samplesPerBar * 2 && i < data.length; i++) {
      min = Math.min(min, data[i]); max = Math.max(max, data[i]);
    }
    const y = (1 + min) * height / 2;
    const barHeight = Math.max(1, (max - min) * height / 2);
    ctx.fillRect(x, y, 2, barHeight);
  }
  const clipStart = (selectedStart() / buffer.duration) * width;
  const clipEnd = ((selectedStart() + selectedLength()) / buffer.duration) * width;
  ctx.fillStyle = 'rgba(35, 18, 76, .46)';
  ctx.fillRect(0, 0, clipStart, height);
  ctx.fillRect(clipEnd, 0, width - clipEnd, height);
  ctx.strokeStyle = '#4d209b';
  ctx.lineWidth = 2;
  ctx.strokeRect(clipStart + 1, 1, Math.max(1, clipEnd - clipStart - 2), height - 2);
}

async function loadFile(file) {
  if (!file) return;
  try {
    status.textContent = 'Getting your sound ready…';
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    selectedName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'my-chime';
    fileName.textContent = file.name;
    durationLabel.textContent = `${time(buffer.duration)} total`;
    lengthSlider.max = Math.min(30, buffer.duration);
    lengthSlider.value = Math.min(30, buffer.duration);
    startSlider.value = 0;
    workspace.hidden = false;
    dropZone.hidden = true;
    startOver.hidden = false;
    refreshControls();
    status.textContent = 'Choose the best part of your sound.';
  } catch (error) {
    console.error(error);
    status.textContent = 'That file could not be read. Please try another audio file.';
  }
}

function playPreview() {
  if (!buffer) return;
  if (currentSource) { currentSource.stop(); return; }
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  const length = selectedLength();
  const now = audioContext.currentTime;
  const inSeconds = Math.min(Number(fadeIn.value), length / 2);
  const outSeconds = Math.min(Number(fadeOut.value), length / 2);
  gain.gain.setValueAtTime(inSeconds ? 0 : 1, now);
  if (inSeconds) gain.gain.linearRampToValueAtTime(1, now + inSeconds);
  if (outSeconds) gain.gain.setValueAtTime(1, now + Math.max(inSeconds, length - outSeconds));
  if (outSeconds) gain.gain.linearRampToValueAtTime(0, now + length);
  source.buffer = buffer;
  source.connect(gain).connect(audioContext.destination);
  source.start(0, selectedStart(), length);
  currentSource = source;
  previewButton.textContent = '■ Stop preview';
  source.onended = () => { currentSource = null; previewButton.textContent = '▶ Preview clip'; };
}

function toWav(bufferToWrite, start, seconds, fadeInSeconds, fadeOutSeconds) {
  const sampleRate = bufferToWrite.sampleRate;
  const channels = Math.min(2, bufferToWrite.numberOfChannels);
  const frames = Math.floor(seconds * sampleRate);
  const startFrame = Math.floor(start * sampleRate);
  const bytes = 44 + frames * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const writeString = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  writeString(0, 'RIFF'); view.setUint32(4, 36 + frames * channels * 2, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  const fadeInFrames = Math.floor(Math.min(fadeInSeconds, seconds / 2) * sampleRate);
  const fadeOutFrames = Math.floor(Math.min(fadeOutSeconds, seconds / 2) * sampleRate);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    let volume = 1;
    if (fadeInFrames && frame < fadeInFrames) volume = frame / fadeInFrames;
    if (fadeOutFrames && frame > frames - fadeOutFrames) volume = Math.min(volume, (frames - frame) / fadeOutFrames);
    for (let channel = 0; channel < channels; channel++) {
      const source = bufferToWrite.getChannelData(channel)[Math.min(startFrame + frame, bufferToWrite.length - 1)] || 0;
      view.setInt16(offset, Math.max(-1, Math.min(1, source * volume)) * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}

function downloadClip() {
  if (!buffer) return;
  const length = Math.min(selectedLength(), buffer.duration - selectedStart());
  status.textContent = 'Saving your ringtone sound…';
  window.setTimeout(() => {
    const blob = toWav(buffer, selectedStart(), length, Number(fadeIn.value), Number(fadeOut.value));
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedName}-ringtone.wav`;
    link.click();
    URL.revokeObjectURL(link.href);
    status.textContent = 'Saved! Use the iPhone steps below to add it as a ringtone or alarm.';
  }, 50);
}

input.addEventListener('change', (event) => loadFile(event.target.files[0]));
['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
[startSlider, lengthSlider].forEach((slider) => slider.addEventListener('input', refreshControls));
previewButton.addEventListener('click', playPreview);
downloadButton.addEventListener('click', downloadClip);
startOver.addEventListener('click', () => { if (currentSource) currentSource.stop(); input.value = ''; buffer = null; workspace.hidden = true; dropZone.hidden = false; startOver.hidden = true; status.textContent = ''; });
window.addEventListener('resize', drawWaveform);

