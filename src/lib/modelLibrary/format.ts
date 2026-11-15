/**
 * File checks for model import: format detection (GLB magic / glTF JSON),
 * self-contained .gltf (every buffer and image embedded as a data: URI or a
 * bufferView) and the size limit. Messages are Japanese (shown in the dialog).
 */
import { MODEL_MAX_BYTES, MODEL_WARN_BYTES, type ModelFormat } from "./types";

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Size check before reading the file: an error above the limit, a warning above ~15 MB. */
export function checkModelFileSize(sizeBytes: number): { error?: string; warning?: string } {
  if (sizeBytes > MODEL_MAX_BYTES) {
    return { error: `ファイルが大きすぎます（${formatBytes(sizeBytes)}）。${formatBytes(MODEL_MAX_BYTES)} 以下のモデルを使ってください。` };
  }
  if (sizeBytes > MODEL_WARN_BYTES) {
    return { warning: `大きなファイルです（${formatBytes(sizeBytes)}）。表示が重くなることがあります。` };
  }
  return {};
}

/** Extension check (before reading): only .glb / .gltf. */
export function checkModelFileName(fileName: string): string | null {
  if (/\.(glb|gltf)$/i.test(fileName)) return null;
  const ext = /\.([^./\\]+)$/.exec(fileName)?.[1];
  return `${ext ? `.${ext} 形式` : "この形式"}は読み込めません。glTF 2.0（.glb、またはデータ埋め込みの .gltf）に変換してから読み込んでください。`;
}

type GltfJson = {
  asset?: { version?: unknown };
  buffers?: { uri?: unknown }[];
  images?: { uri?: unknown }[];
};

/**
 * Detect the format from the bytes and check that a .gltf is self-contained.
 * Returns the format, or an error message.
 */
export function inspectModelData(data: ArrayBuffer): { format: ModelFormat } | { error: string } {
  if (data.byteLength >= 12 && new DataView(data).getUint32(0, true) === GLB_MAGIC) {
    const version = new DataView(data).getUint32(4, true);
    if (version !== 2) return { error: `glTF ${version}.0 のGLBは読み込めません。glTF 2.0 で書き出してください。` };
    return { format: "glb" };
  }
  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
  } catch {
    return { error: "glTF / GLB ファイルとして読み取れませんでした。" };
  }
  if (!json || typeof json !== "object" || !json.asset) return { error: "glTF ファイルとして読み取れませんでした（asset がありません）。" };
  if (typeof json.asset.version !== "string" || !json.asset.version.startsWith("2")) {
    return { error: "glTF 2.0 のファイルだけ読み込めます。" };
  }
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].find(
    (entry) => typeof entry?.uri === "string" && !entry.uri.startsWith("data:"),
  );
  if (external) {
    return {
      error: `外部ファイル（${String(external.uri)}）を参照する .gltf は読み込めません。.glb、またはデータ埋め込みの .gltf で書き出してください。`,
    };
  }
  return { format: "gltf" };
}
