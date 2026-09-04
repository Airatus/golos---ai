// Элементы интерфейса
const recordBtn = document.getElementById('recordBtn');
const pulseRing = document.getElementById('pulseRing');
const timerDisplay = document.getElementById('timer');
const statusText = document.getElementById('statusText');
const outputField = document.getElementById('outputField');
const copyBtn = document.getElementById('copyBtn');
const clearBtn = document.getElementById('clearBtn');
const engineSelect = document.getElementById('engineSelect');
const apiKeyGroup = document.getElementById('apiKeyGroup');
const apiKeyLabel = document.getElementById('apiKeyLabel');
const apiKeyInput = document.getElementById('apiKeyInput');
const installBtn = document.getElementById('installBtn');

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let seconds = 0;
let speechRecognition = null;
let deferredPrompt = null;

// Инициализация ключа
apiKeyInput.value = localStorage.getItem('golos_api_key') || '';
apiKeyInput.addEventListener('input', (e) => {
  localStorage.setItem('golos_api_key', e.target.value.trim());
});

// Смена движка (меняем подсказки для ключей)
engineSelect.addEventListener('change', () => {
  const engine = engineSelect.value;
  if (engine === 'webspeech') {
    apiKeyGroup.classList.add('hidden');
  } else {
    apiKeyGroup.classList.remove('hidden');
    if (engine === 'gemini') {
      apiKeyLabel.innerText = 'API Key (Google Gemini):';
      apiKeyInput.placeholder = 'AIzaSy...';
    } else {
      apiKeyLabel.innerText = 'API Key (OpenAI):';
      apiKeyInput.placeholder = 'sk-...';
    }
  }
});

// Кнопка записи
recordBtn.addEventListener('click', () => {
  if (!isRecording) startRecording();
  else stopRecording();
});

// Таймер
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

function stopTimer() { clearInterval(timerInterval); }

// Старт записи
async function startRecording() {
  const engine = engineSelect.value;
  let success = false;

  if (engine === 'webspeech') {
    success = startWebSpeech();
  } else {
    success = await startCloudRecord();
  }

  if (success) {
    isRecording = true;
    recordBtn.classList.add('recording');
    recordBtn.innerHTML = '⏹';
    pulseRing.classList.add('active');
    statusText.innerText = 'Слушаю вас...';
    startTimer();
  }
}

// Остановка записи
function stopRecording() {
  if (!isRecording) return;
  isRecording = false; // Блокируем рекурсию событий onend

  const engine = engineSelect.value;
  if (engine === 'webspeech' && speechRecognition) {
    speechRecognition.stop();
  } else if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  recordBtn.classList.remove('recording');
  recordBtn.innerHTML = '🎤';
  pulseRing.classList.remove('active');
  stopTimer();
  statusText.innerText = engine === 'webspeech' ? 'Готово' : 'Обработка аудио...';
}

// ==========================================
// 1. Web Speech API (Офлайн)
// ==========================================
function startWebSpeech() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    alert('Браузер не поддерживает Web Speech. Выберите Gemini.');
    return false;
  }
  
  speechRecognition = new SpeechRec();
  speechRecognition.lang = 'ru-RU';
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;

  speechRecognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) outputField.value += (outputField.value ? ' ' : '') + event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
  };
  speechRecognition.onend = () => { stopRecording(); };
  speechRecognition.start();
  return true;
}

// ==========================================
// 2. Запись для облачных API (Gemini / OpenAI)
// ==========================================
async function startCloudRecord() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    alert('Укажите API-ключ в настройках!');
    return false;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const engine = engineSelect.value;
      if (engine === 'gemini') await processGeminiAPI();
      else await processWhisperAPI();
    };
    mediaRecorder.start();
    return true;
  } catch (err) {
    alert('Нет доступа к микрофону: ' + err.message);
    return false;
  }
}

// ==========================================
// 3. Интеграция с Gemini 1.5 Flash
// ==========================================
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function processGeminiAPI() {
  const apiKey = apiKeyInput.value.trim();
  const audioBlob = new Blob(audioChunks, { type: audioChunks[0]?.type || 'audio/webm' });

  try {
    statusText.innerText = 'Gemini слушает и редактирует...';
    const base64Audio = await blobToBase64(audioBlob);

    const promptText = `Ты — встроенный ИИ-редактор голосового приложения.
    Выполни следующие задачи:
    1. Распознай речь из прикрепленного аудио.
    2. Автоматически определи язык и отвечай на нем же.
    3. Убери все слова-паразиты, мычания (э-э, ну) и повторы.
    4. Расставь идеальную пунктуацию.
    5. Исправь оговорки и логические противоречия (например, если спикер сказал "встретимся завтра... хотя нет, в пятницу", напиши только "встретимся в пятницу").
    Выведи ТОЛЬКО финальный чистый текст без приветствий и комментариев.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: promptText },
            { inlineData: { mimeType: audioBlob.type || 'audio/webm', data: base64Audio } }
          ]
        }],
        generationConfig: { temperature: 0.2 }
      })
    });

    const data = await response.json();
    
    if (data.candidates && data.candidates.length > 0) {
      const cleanText = data.candidates[0].content.parts[0].text;
      outputField.value += (outputField.value ? '\n\n' : '') + cleanText.trim();
      statusText.innerText = 'Готово';
    } else {
      statusText.innerText = 'Ошибка обработки Gemini API';
      console.error(data);
    }
  } catch (error) {
    console.error('Ошибка Gemini:', error);
    statusText.innerText = 'Ошибка соединения';
  }
}

// ==========================================
// 4. OpenAI (Whisper + GPT)
// ==========================================
async function processWhisperAPI() {
  const apiKey = apiKeyInput.value.trim();
  const audioBlob = new Blob(audioChunks, { type: audioChunks[0]?.type || 'audio/webm' });
  const formData = new FormData();
  formData.append('file', audioBlob, 'record.webm');
  formData.append('model', 'whisper-1');

  try {
    statusText.innerText = 'Шаг 1: Распознавание Whisper...';
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    const data = await res.json();
    if (data.text) {
      statusText.innerText = 'Шаг 2: Умная редактура GPT...';
      const smartText = await processWithGPT(data.text, apiKey);
      outputField.value += (outputField.value ? '\n\n' : '') + smartText;
      statusText.innerText = 'Готово';
    } else {
      statusText.innerText = 'Ошибка Whisper API';
    }
  } catch (error) {
    statusText.innerText = 'Ошибка OpenAI API';
  }
}

async function processWithGPT(rawText, apiKey) {
  const systemPrompt = `Ты — встроенный ИИ-редактор. Определи язык, убери слова-паразиты, расставь пунктуацию и исправь оговорки. Выведи только готовый чистый текст.`;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: rawText }],
        temperature: 0.2
      })
    });
    const gptData = await response.json();
    return gptData.choices[0].message.content.trim();
  } catch (e) { return rawText; }
}

// ==========================================
// Утилиты (Копирование, Сброс, PWA)
// ==========================================
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
  if (outcome === 'accepted') installBtn.classList.add('hidden');
  deferredPrompt = null;
});
