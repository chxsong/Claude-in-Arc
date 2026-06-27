(async () => {
  const content = document.getElementById("content");

  try {
    // Get exported GIF data from storage
    const result = await chrome.storage.local.get("exportedGifData");
    const data = result.exportedGifData;

    if (!data || !data.base64 || !data.filename) {
      throw new Error("No GIF data found. The export may have expired.");
    }

    // Check if data is stale (older than 5 minutes)
    if (Date.now() - data.timestamp > 300000) {
      throw new Error("GIF data expired. Please export again.");
    }

    // Convert base64 to blob
    const byteCharacters = atob(data.base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: "image/gif" });
    const blobUrl = URL.createObjectURL(blob);

    // Show the GIF - clicking downloads it
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = data.filename;

    const img = document.createElement("img");
    img.src = blobUrl;
    img.alt = data.filename;

    link.appendChild(img);
    content.appendChild(link);

    // Update page title with filename
    document.title = data.filename;

    // Clean up storage after successful load
    await chrome.storage.local.remove("exportedGifData");
  } catch (error) {
    console.error("[GIF Viewer] Error:", error);
    const errorDiv = document.createElement("div");
    errorDiv.className = "error";
    errorDiv.textContent = error.message;
    content.appendChild(errorDiv);
  }
})();
