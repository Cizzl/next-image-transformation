import { cache } from "bun:sqlite";

const version = "0.0.4";
let allowedDomains = process?.env?.ALLOWED_REMOTE_DOMAINS?.split(",") || ["*"];
let imgproxyUrl = process?.env?.IMGPROXY_URL || "http://imgproxy:8080";
if (process.env.NODE_ENV === "development") {
  imgproxyUrl = "http://localhost:8888";
}
allowedDomains = allowedDomains.map((d) => d.trim());

// Initialize cache
const imageCache = cache({
  name: "image_cache",
  maxEntries: 1000, // Adjust as needed
});

Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response(
        `<h3>Next Image Transformation v${version}</h3>More info <a href="https://github.com/coollabsio/next-image-transformation">https://github.com/coollabsio/next-image-transformation</a>.`,
        {
          headers: {
            "Content-Type": "text/html",
          },
        }
      );
    }
    if (url.pathname === "/health") {
      return new Response("OK");
    }
    if (url.pathname.startsWith("/image/")) return await resize(url);
    return Response.redirect(
      "https://github.com/coollabsio/next-image-transformation",
      302
    );
  },
});

async function resize(url) {
  const preset = "pr:sharp";
  const src = url.pathname.split("/").slice(2).join("/");
  const origin = new URL(src).hostname;
  const allowed = allowedDomains.filter((domain) => {
    if (domain === "*") return true;
    if (domain === origin) return true;
    if (domain.startsWith("*.") && origin.endsWith(domain.split("*.").pop()))
      return true;
    return false;
  });
  if (allowed.length === 0) {
    return new Response(
      `Domain (${origin}) not allowed. More details here: https://github.com/coollabsio/next-image-transformation`,
      { status: 403 }
    );
  }
  const width = url.searchParams.get("width") || 0;
  const height = url.searchParams.get("height") || 0;
  const quality = url.searchParams.get("quality") || 75;

  // Create a cache key
  const cacheKey = `${src}:${width}:${height}:${quality}`;

  // Check if the image is in the cache
  const cachedImage = imageCache.get(cacheKey);
  if (cachedImage) {
    return new Response(cachedImage.body, {
      headers: cachedImage.headers,
    });
  }

  try {
    const imgproxyUrl = `${imgproxyUrl}/${preset}/resize:fill:${width}:${height}/q:${quality}/plain/${src}`;
    const image = await fetch(imgproxyUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,*/*",
      },
    });
    const headers = new Headers(image.headers);
    headers.set("Server", "NextImageTransformation");
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    // Clone the response before caching
    const clonedResponse = image.clone();
    const body = await clonedResponse.arrayBuffer();

    // Cache the image
    imageCache.set(cacheKey, { body, headers: Object.fromEntries(headers) });

    return new Response(image.body, {
      headers,
    });
  } catch (e) {
    console.log(e);
    return new Response("Error resizing image");
  }
}
