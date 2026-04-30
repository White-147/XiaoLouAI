export type PreparedReferenceUpload = {
  file: File;
  convertedFromPng: boolean;
};

function hasPngExtension(fileName: string) {
  return /\.png$/i.test(fileName.trim());
}

function shouldConvertPngToJpeg(file: File) {
  const normalizedType = String(file.type || "").toLowerCase();
  return normalizedType === "image/png" || (!normalizedType && hasPngExtension(file.name));
}

function replaceFileExtension(fileName: string, nextExtension: string) {
  const normalizedName = fileName.trim() || "reference";
  if (/\.[^.]+$/.test(normalizedName)) {
    return normalizedName.replace(/\.[^.]+$/, nextExtension);
  }
  return `${normalizedName}${nextExtension}`;
}

function loadImageElement(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode the PNG reference image."));
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to encode the reference image as JPEG."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function convertPngFileToJpeg(file: File) {
  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImageElement(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      throw new Error("The PNG reference image has invalid dimensions.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser could not create a canvas for reference image conversion.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    return new File([blob], replaceFileExtension(file.name, ".jpg"), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareReferenceUploadFile(file: File): Promise<PreparedReferenceUpload> {
  if (!shouldConvertPngToJpeg(file)) {
    return { file, convertedFromPng: false };
  }

  return {
    file: await convertPngFileToJpeg(file),
    convertedFromPng: true,
  };
}
