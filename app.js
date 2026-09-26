const input = document.querySelector('#audio-file');
const dropZone = document.querySelector('#drop-zone');
const workspace = document.querySelector('#workspace');
const startSlider = document.querySelector('#clip-start');
const lengthSlider = document.querySelector('#clip-length');
const startTime = document.querySelector('#start-time');
const lengthTime = document.querySelector('#length-time');
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
let video;
let videoSource;
let videoGain;
let currentSource;
let selectedName = 'my-chime';
let mediaDuration = 0;
let previewTimer;
let objectUrl;

function time(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const secs = String(whole % 60).padStart(2, '0');
  const mins = Math.floor(whole / 60);
  if (mins >= 60) return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}:${secs}`;
  return `${mins}:${secs}`;
}

function parseTime(value) {
  const parts = String(value).trim().split(':').map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function selectedLength() { return Number(lengthSlider.value); }
function selectedStart() { return Number(startSlider.value); }
function totalDuration() { return buffer?.duration || mediaDuration; }

function refreshControls() {
  const duration = totalDuration();
  if (!duration) return;
  const maxLength = Math.max(1, duration);
  lengthSlider.max = maxLength;
  const maxStart = Math.max(0, duration - selectedLength());
  startSlider.max = maxStart;
  if (selectedStart() > maxStart) startSlider.value = maxStart;
  const actualLength = Math.min(selectedLength(), duration - selectedStart());
  lengthSlider.value = Math.max(1, actualLength);
  startTime.value = time(selectedStart());
  lengthTime.value = time(actualLength);
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
  const duration = totalDuration();
  if (!duration) return;
  resizeCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#b29ce8';
  if (buffer) {
    const data = buffer.getChannelData(0);
    const samplesPerBar = Math.max(1, Math.floor(data.length / width));
    for (let x = 0; x < width; x += 2) {
      let min = 1, max = -1;
      const first = Math.floor(x * samplesPerBar);
      for (let i = first; i < first + samplesPerBar * 2 && i < data.length; i++) {
        min = Math.min(min, data[i]); max = Math.max(max, data[i]);
      }
      const y = (1 + min) * height / 2;
      ctx.fillRect(x, y, 2, Math.max(1, (max - min) * height / 2));
    }
  } else {
    for (let x = 0; x < width; x += 8) {
      const barHeight = 12 + Math.abs(Math.sin(x * 0.11) * Math.cos(x * 0.043)) * (height * 0.35);
      ctx.fillRect(x, (height - barHeight) / 2, 3, barHeight);
    }
  }
  const clipStart = (selectedStart() / duration) * width;
  const clipEnd = ((selectedStart() + selectedLength()) / duration) * width;
  ctx.fillStyle = 'rgba(35, 18, 76, .46)';
  ctx.fillRect(0, 0, clipStart, height);
  ctx.fillRect(clipEnd, 0, width - clipEnd, height);
  ctx.strokeStyle = '#4d209b';
  ctx.lineWidth = 2;
  ctx.strokeRect(clipStart + 1, 1, Math.max(1, clipEnd - clipStart - 2), height - 2);
}

function disposeMedia() {
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
  window.clearTimeout(previewTimer);
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    video = null;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  buffer = null;
  mediaDuration = 0;
  previewButton.textContent = '▶ Preview clip';
}

function displayLoaded(file, duration) {
  selectedName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'my-chime';
  fileName.textContent = file.name;
  durationLabel.textContent = `${time(duration)} total`;
  startSlider.value = 0;
  lengthSlider.min = Math.min(1, duration);
  lengthSlider.max = duration;
  lengthSlider.value = duration;
  workspace.hidden = false;
  dropZone.hidden = true;
  startOver.hidden = false;
  refreshControls();
  status.textContent = 'Choose any section from the full recording.';
}

async function loadVideo(file) {
  objectUrl = URL.createObjectURL(file);
  video = document.createElement('video');
  video.preload = 'metadata';
  video.playsInline = true;
  video.muted = false;
  video.src = objectUrl;
  video.style.position = 'fixed';
  video.style.left = '-9999px';
  document.body.append(video);
  await new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', reject, { once: true });
  });
  if (!Number.isFinite(video.duration)) throw new Error('Video duration is unavailable');
  mediaDuration = video.duration;
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  videoSource = audioContext.createMediaElementSource(video);
  videoGain = audioContext.createGain();
  videoSource.connect(videoGain);
  videoGain.connect(audioContext.destination);
}

async function loadFile(file) {
  if (!file) return;
  disposeMedia();
  try {
    status.textContent = 'Getting your sound ready…';
    if (file.type.startsWith('video/')) {
      await loadVideo(file);
      displayLoaded(file, mediaDuration);
      status.textContent = 'Video loaded. Its sound will be captured as the selected section plays.';
    } else {
      audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      mediaDuration = buffer.duration;
      displayLoaded(file, buffer.duration);
    }
  } catch (error) {
    console.error(error);
    disposeMedia();
    status.textContent = 'That file could not be read. Please try another audio or video file.';
  }
}

function scheduleFade(length) {
  const now = audioContext.currentTime;
  const inSeconds = Math.min(Number(fadeIn.value), length / 2);
  const outSeconds = Math.min(Number(fadeOut.value), length / 2);
  videoGain.gain.cancelScheduledValues(now);
  videoGain.gain.setValueAtTime(inSeconds ? 0 : 1, now);
  if (inSeconds) videoGain.gain.linearRampToValueAtTime(1, now + inSeconds);
  if (outSeconds) videoGain.gain.setValueAtTime(1, now + Math.max(inSeconds, length - outSeconds));
  if (outSeconds) videoGain.gain.linearRampToValueAtTime(0, now + length);
}

function finishVideoPlayback() {
  if (!video) return;
  video.pause();
  videoGain.gain.cancelScheduledValues(audioContext.currentTime);
  videoGain.gain.setValueAtTime(1, audioContext.currentTime);
  currentSource = null;
  previewButton.textContent = '▶ Preview clip';
}

async function playPreview() {
  if (!totalDuration()) return;
  if (currentSource || (video && !video.paused)) {
    if (currentSource?.stop) { try { currentSource.stop(); } catch {} }
    finishVideoPlayback();
    window.clearTimeout(previewTimer);
    return;
  }
  if (audioContext?.state === 'suspended') await audioContext.resume();
  const length = selectedLength();
  if (video) {
    video.currentTime = selectedStart();
    await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
    scheduleFade(length);
    try {
      await video.play();
      previewButton.textContent = '■ Stop preview';
      previewTimer = window.setTimeout(finishVideoPlayback, length * 1000);
    } catch {
      status.textContent = 'Your browser could not preview this video. Try another video format.';
    }
    return;
  }
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
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
  const bytesPerFrame = channels * 2;
  const view = new DataView(new ArrayBuffer(44 + frames * bytesPerFrame));
  const writeString = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  writeString(0, 'RIFF'); view.setUint32(4, 36 + frames * bytesPerFrame, true); writeString(8, 'WAVE');
  writeString(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * bytesPerFrame, true); view.setUint16(32, bytesPerFrame, true); view.setUint16(34, 16, true);
  writeString(36, 'data'); view.setUint32(40, frames * bytesPerFrame, true);
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

function saveBlob(blob, extension) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${selectedName}-chime.${extension}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportVideoClip() {
  if (!window.MediaRecorder || !audioContext.createScriptProcessor) {
    status.textContent = 'Video audio export is not supported in this browser. Try saving the video audio as an audio file first.';
    return;
  }
  const seconds = selectedLength();
  const sampleRate = audioContext.sampleRate;
  const channels = 2;
  const chunks = [[], []];
  let recording = false;
  const processor = audioContext.createScriptProcessor(4096, channels, channels);
  const silent = audioContext.createGain();
  silent.gain.value = 0;
  videoGain.connect(processor);
  processor.connect(silent).connect(audioContext.destination);
  processor.onaudioprocess = (event) => {
    if (!recording) return;
    for (let channel = 0; channel < channels; channel++) chunks[channel].push(new Float32Array(event.inputBuffer.getChannelData(Math.min(channel, event.inputBuffer.numberOfChannels - 1))));
  };
  video.currentTime = selectedStart();
  await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
  scheduleFade(seconds);
  status.textContent = `Capturing video audio… keep this page open for ${time(seconds)}.`;
  downloadButton.disabled = true;
  try {
    recording = true;
    await video.play();
    await new Promise((resolve, reject) => {
      previewTimer = window.setTimeout(resolve, seconds * 1000);
      video.addEventListener('error', reject, { once: true });
    });
    recording = false;
    video.pause();
    processor.disconnect();
    silent.disconnect();
    videoGain.disconnect(processor);
    processor.onaudioprocess = null;
    const frames = chunks[0].reduce((sum, chunk) => sum + chunk.length, 0);
    const wav = new DataView(new ArrayBuffer(44 + frames * channels * 2));
    const writeString = (offset, text) => [...text].forEach((char, i) => wav.setUint8(offset + i, char.charCodeAt(0)));
    writeString(0, 'RIFF'); wav.setUint32(4, 36 + frames * channels * 2, true); writeString(8, 'WAVE');
    writeString(12, 'fmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, channels, true);
    wav.setUint32(24, sampleRate, true); wav.setUint32(28, sampleRate * channels * 2, true); wav.setUint16(32, channels * 2, true); wav.setUint16(34, 16, true);
    writeString(36, 'data'); wav.setUint32(40, frames * channels * 2, true);
    let offset = 44;
    for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
      const chunkIndex = Math.floor(frame / 4096);
      const sample = chunks[channel][chunkIndex]?.[frame % 4096] || 0;
      wav.setInt16(offset, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
      offset += 2;
    }
    saveBlob(new Blob([wav], { type: 'audio/wav' }), 'wav');
    status.textContent = 'Saved! Use the iPhone steps below to add your sound.';
  } catch (error) {
    recording = false;
    console.error(error);
    status.textContent = 'The video could not be played or captured. Try another video format.';
  } finally {
    processor.disconnect();
    silent.disconnect();
    try { videoGain.disconnect(processor); } catch {}
    videoGain.connect(audioContext.destination);
    downloadButton.disabled = false;
    finishVideoPlayback();
  }
}

function downloadClip() {
  if (!totalDuration()) return;
  const length = Math.min(selectedLength(), totalDuration() - selectedStart());
  if (video) { exportVideoClip(); return; }
  status.textContent = 'Saving your sound…';
  downloadButton.disabled = true;
  window.setTimeout(() => {
    try {
      saveBlob(toWav(buffer, selectedStart(), length, Number(fadeIn.value), Number(fadeOut.value)), 'wav');
      status.textContent = 'Saved! Use the iPhone steps below to add your sound.';
    } catch (error) {
      console.error(error);
      status.textContent = 'This clip is too large to export in one file on this device. Try selecting a shorter section.';
    } finally { downloadButton.disabled = false; }
  }, 30);
}

function applyTimeField(field, type) {
  const parsed = parseTime(field.value);
  if (!Number.isFinite(parsed)) { refreshControls(); return; }
  if (type === 'start') startSlider.value = Math.min(parsed, Math.max(0, totalDuration() - selectedLength()));
  else lengthSlider.value = Math.min(Math.max(parsed, Number(lengthSlider.min)), totalDuration() - selectedStart());
  refreshControls();
}

input.addEventListener('change', (event) => loadFile(event.target.files[0]));
['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', (event) => loadFile(event.dataTransfer.files[0]));
[startSlider, lengthSlider].forEach((slider) => slider.addEventListener('input', refreshControls));
startTime.addEventListener('change', () => applyTimeField(startTime, 'start'));
lengthTime.addEventListener('change', () => applyTimeField(lengthTime, 'length'));
previewButton.addEventListener('click', playPreview);
downloadButton.addEventListener('click', downloadClip);
startOver.addEventListener('click', () => {
  disposeMedia();
  input.value = '';
  workspace.hidden = true;
  dropZone.hidden = false;
  startOver.hidden = true;
  status.textContent = '';
});
window.addEventListener('resize', drawWaveform);

