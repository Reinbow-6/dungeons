import { config } from "dotenv";

config({ path: ".env.local" });
config();

const GROQ_TRANSCRIPTIONS_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const STT_MODEL_ID = "whisper-large-v3-turbo";

function buildSineWavBuffer({
  sampleRate = 16000,
  durationSec = 0.5,
  frequencyHz = 440,
  amplitude = 1200,
} = {}) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequencyHz * (i / sampleRate)) * amplitude,
    );
    buffer.writeInt16LE(sample, 44 + i * 2);
  }

  return buffer;
}

const apiKey = process.env.GROQ_API_KEY?.trim();
if (!apiKey) {
  console.log(`[SKIP] groq:${STT_MODEL_ID} — falta GROQ_API_KEY.`);
  process.exit(0);
}

const startedAt = Date.now();
let httpStatus = null;

try {
  const wavBuffer = buildSineWavBuffer();
  const formData = new FormData();
  const audioFile = new File([wavBuffer], "smoke-test.wav", {
    type: "audio/wav",
  });
  formData.append("file", audioFile);
  formData.append("model", STT_MODEL_ID);
  formData.append("language", "es");
  formData.append("response_format", "json");

  const response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  httpStatus = response.status;
  const latencyMs = Date.now() - startedAt;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} al consultar Groq STT`);
  }

  const payload = await response.json();
  if (!payload || typeof payload.text !== "string") {
    throw new Error("Respuesta sin campo string `text`");
  }

  console.log(
    JSON.stringify({
      status: "PASS",
      modelId: STT_MODEL_ID,
      latencyMs,
      textLength: payload.text.length,
    }),
  );
} catch (err) {
  const latencyMs = Date.now() - startedAt;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const safeMessage = apiKey ? rawMessage.split(apiKey).join("[redacted]") : rawMessage;
  console.error(
    JSON.stringify({
      status: "FAIL",
      modelId: STT_MODEL_ID,
      latencyMs,
      httpStatus,
      errorMessage: safeMessage,
    }),
  );
  process.exitCode = 1;
}
