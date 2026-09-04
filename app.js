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
const apiKeyInput = document.getElementById('apiKeyInput');
const installBtn = document.getElementById('installBtn');

let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let seconds = 0;
let speechRecognition = null;
let deferredPrompt = null;

// Инициализация ключа из LocalStorage
apiKeyInput.value = localStorage.getItem('golos_api_key') || '';
apiKeyInput.addEventListener('input', (e) => {
  localStorage.setItem('golos_api_key', e.target.value.trim());
});

// Управление видимостью поля для API ключа
engineSelect.addEventListener('change', () => {
  if (engineSelect.value === 'whisper') {
    apiKeyGroup.classList.remove('hidden');
  } else {
    apiKeyGroup.classList.add('hidden');
  }
});

// Кнопка записи
recordBtn.addEventListener('click', () => {
  if (!isRecording) {
    startRecording();
  } else {
    stopRecording();
  }
});

// Логика таймера
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

// Старт записи
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

// Остановка записи
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
  
  if (engine === 'webspeech') {
    statusText.innerText = 'Готово';
  } else {
    statusText.innerText = 'Обработка аудио...';
  }
}

// ==========================================
// 1. Движок: Web Speech API (Офлайн/Браузер)
// ==========================================
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
  };

  speechRecognition.start();
}

// ==========================================
// 2. Движок: AI Pipeline (Whisper + GPT-4o-mini)
// ==========================================
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

// Этап 1: Распознавание речи с автоопределением 100+ языков
async function processWhisperAPI() {
  const apiKey = apiKeyInput.value.trim();
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const formData = new FormData();
  formData.append('file', audioBlob, 'record.webm');
  formData.append('model', 'whisper-1');
  // Параметр 'language' не передаем — Whisper определит язык автоматически

  try {
    statusText.innerText = 'Распознавание речи...';
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    const data = await res.json();
    
    if (data.text) {
      statusText.innerText = 'Умная редактура и анализ контекста...';
      
      // Этап 2: Отправляем сырой текст на смысловую обработку
      const smartText = await processWithGPT(data.text, apiKey);
      
      outputField.value += (outputField.value ? '\n\n' : '') + smartText;
      statusText.innerText = 'Готово';
    } else {
      statusText.innerText = 'Ошибка распознавания API';
    }
  } catch (error) {
    console.error(error);
    statusText.innerText = 'Ошибка отправки файла';
  }
}

// Этап 2: Смысловая фильтрация, очистка слов-паразитов и исправление оговорок
async function processWithGPT(rawText, apiKey) {
  const systemPrompt = `Ты — встроенный ИИ-редактор голосового приложения. Твоя задача обработать расшифрованный текст:
1. Автоматически определи язык текста и отвечай на нем же.
2. Убери все слова-паразиты, мычания (э-э, ну, типа) и повторы.
3. Расставь идеальную пунктуацию и сделай фразы понятнее.
4. Исправь оговорки и логические противоречия. Если спикер передумал в процессе (например: "встретимся завтра... хотя нет, лучше в пятницу"), перепиши текст, оставив только финальное решение ("встретимся в пятницу").
Выведи только готовый чистый текст без лишних комментариев.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawText }
        ],
        temperature: 0.2
      })
    });

    const gptData = await response.json();
    if (gptData.choices && gptData.choices.length > 0) {
      return gptData.choices[0].message.content.trim();
    }
    return rawText;
  } catch (error) {
    console.error('Ошибка GPT:', error);
    return rawText; // В случае сбоя возвращаем сырой текст от Whisper
  }
}

// ==========================================
// Утилиты: Копирование, Очистка и Установка PWA
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

// Обработка кнопки установки PWA
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
