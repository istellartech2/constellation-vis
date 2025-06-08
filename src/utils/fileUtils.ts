export function downloadFile(name: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export async function handleFileLoad<T>(
  file: File,
  setter: (t: string) => void,
  parser: (t: string) => T,
  validator?: (v: T) => void,
) {
  const text = await file.text();
  try {
    const parsed = parser(text);
    if (validator) validator(parsed);
    setter(text);
  } catch (e) {
    alert("Invalid file: " + (e as Error).message);
  }
}