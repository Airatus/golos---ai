const recordBtn = document.getElementById('recordBtn');
const pulseRing = document.getElementById('pulseRing');
const timerDisplay = document.getElementById('timer');
const statusText = document.getElementById('statusText');
const outputField = document.getElementById('outputField');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const engineSelect = document.getElementById('engineSelect');
const apiKeyGroup = document.getElementById('apiKeyGroup');
const apiKeyInput = document.getElementById('apiKeyInput');
const installBtn = document.getElementById('installBtn');

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let seconds = 0;
let speechRecognition = null;
let deferredPrompt = null;

apiKeyInput.value = localStorage.getItem('golos_api_key') || '';
apiKeyInput.addEventListener('input', (e) => {
  localStorage.setItem('golos_api_key', e.target.value.trim());
});

engineSelect.addEventListener('change', () => {
  if (engineSelect.value === 'whisper') {
    apiKeyGroup.classList.remove('hidden');
  } else {
    apiKeyGroup.classList.add('hidden');
  }
});

recordBtn.addEventListener('click', () => {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
});

function startTimer() {
  seconds = 0;
  timerDisplay.innerText = '00:00';
  timerInterval = setInterval(() => {
    seconds++;
    const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    timerDisplay.innerText = `${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

async function startRecording() {
  const engine = engineSelect.value;

  if (engine === 'webspeech') {
    startWebSpeech();
  } else {
    await startWhisperRecord();
  }

  isRecording = true;
  recordBtn.classList.add('recording');
  recordBtn.innerHTML = '⏹';
  pulseRing.classList.add('active');
  statusText.innerText = 'Слушаю вас...';
  startTimer();
}

function stopRecording() {
  const engine = engineSelect.value;

  if (engine === 'webspeech' && speechRecognition) {
    speechRecognition.stop();
  } else if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  isRecording = false;
  recordBtn.classList.remove('recording');
  recordBtn.innerHTML = '🎤';
  pulseRing.classList.remove('active');
  stopTimer();
  statusText.innerText = 'Обработка...';
}

function startWebSpeech() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    alert('Ваш браузер не поддерживает Web Speech API. Переключитесь на Whisper API.');
    stopRecording();
    return;
  }

  speechRecognition = new SpeechRec();
  speechRecognition.lang = 'ru-RU';
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;

  speechRecognition.onresult = (event) => {
    let interimTranscript = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        outputField.value += (outputField.value ? ' ' : '') + event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }
  };

  speechRecognition.onerror = (e) => {
    console.error(e.error);
    statusText.innerText = 'Ошибка распознавания';
  };

  speechRecognition.onend = () => {
    if (isRecording) stopRecording();
    statusText.innerText = 'Готово';
  };

  speechRecognition.start();
}

async function startWhisperRecord() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Укажите API-ключ OpenAI в настройках!');
    stopRecording();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      await processWhisperAPI();
    };

    mediaRecorder.start();
  } catch (err) {
    alert('Не удалось получить доступ к микрофону: ' + err.message);
    stopRecording();
  }
}

async function processWhisperAPI() {
  const apiKey = apiKeyInput.value.trim();
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('file', audioBlob, 'record.webm');
  formData.append('model', 'whisper-1');
  formData.append('language', 'ru');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    const data = await res.json();
    if (data.text) {
      outputField.value += (outputField.value ? '\n' : '') + data.text;
      statusText.innerText = 'Готово';
    } else {
      statusText.innerText = 'Ошибка обработки API';
    }
  } catch (error) {
    console.error(error);
    statusText.innerText = 'Ошибка отправки файла';
  }
}

copyBtn.addEventListener('click', async () => {
  if (!outputField.value) return;
  await navigator.clipboard.writeText(outputField.value);
  copyBtn.innerText = '✅ Скопировано!';
  setTimeout(() => (copyBtn.innerText = '📋 Копировать'), 1500);
});

clearBtn.addEventListener('click', () => {
  outputField.value = '';
  statusText.innerText = 'Нажмите для начала записи';
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    installBtn.classList.add('hidden');
  }
  deferredPrompt = null;
});