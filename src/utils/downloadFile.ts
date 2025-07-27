
import axios from "axios";
import fs from "fs";
import path from "path";

/**
 * Downloads a file from a URL to a local destination.
 * @param url - The direct URL of the file to download.
 * @param dest - Local file path to save to, e.g., /tmp/audio.mp3
 */
export async function downloadFile(url: string, dest: string): Promise<void> {
  const writer = fs.createWriteStream(dest);

  const response = await axios({
    method: "GET",
    url,
    responseType: "stream",
    headers: {
      "User-Agent": "Podcast-Transcriber/1.0",
    },
  });

  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}
