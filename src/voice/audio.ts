/** Small PCM helpers: 16-bit WAV in and out, and a loudness envelope for the orb to pulse with. */

export type Pcm = { samples: Float32Array; rate: number };

/** Encodes mono float samples (-1..1) as a 16-bit PCM WAV file. */
export function encodeWav16({ samples, rate }: Pcm): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** Decodes a 16-bit PCM WAV (first channel only), walking chunks since `say` may add extras before "data". */
export function decodeWav16(buf: Buffer): Pcm {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }
  let rate = 0;
  let channels = 1;
  let bits = 0;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      channels = buf.readUInt16LE(body + 2);
      rate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === "data") {
      if (bits !== 16 || !rate) throw new Error(`Unsupported WAV format (${bits}-bit)`);
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) samples[i] = buf.readInt16LE(body + i * 2 * channels) / 0x8000;
      return { samples, rate };
    }
    off = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/**
 * RMS loudness per frame, scaled so the loudest frame is 1. Quiet clips aren't blown up into a full pulse.
 * Values are rounded to keep the message to the orb small.
 */
export function loudnessEnvelope({ samples, rate }: Pcm, frameMs = 1000 / 60): number[] {
  const size = Math.max(1, Math.round((rate * frameMs) / 1000));
  const rms: number[] = [];
  for (let start = 0; start < samples.length; start += size) {
    let sum = 0;
    const end = Math.min(samples.length, start + size);
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    rms.push(Math.sqrt(sum / (end - start)));
  }
  const peak = Math.max(0.05, ...rms);
  return rms.map((v) => Math.round(Math.min(1, v / peak) * 100) / 100);
}
