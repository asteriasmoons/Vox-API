// src/services/lurelia/mediaService.ts
//
// Cloudinary uploads for shared-event attachments and cover artwork.
// Matches the pattern used by challengeSocialService (see uploadFeedPhoto).

import type { Model } from "mongoose";
import { randomUUID } from "crypto";
import cloudinary from "../../utils/cloudinary";

import { LureliaAttachment as AttachmentRaw } from "../../models/lurelia/Attachment";
import { LureliaEventArtwork as EventArtworkRaw } from "../../models/lurelia/EventArtwork";

const Attachment = AttachmentRaw as Model<any>;
const EventArtwork = EventArtworkRaw as Model<any>;

type UploadTarget =
  | { kind: "event"; sharedEventID: string }
  | { kind: "post"; sharedEventID: string; eventPostID: string }
  | { kind: "announcement"; sharedEventID: string; announcementID: string }
  | { kind: "artwork"; sharedEventID: string; makePrimary?: boolean };

export type UploadedAsset = {
  url: string;
  thumbnailURL: string;
  publicId: string;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
};

async function uploadToCloudinary(
  buffer: Buffer,
  folder: string,
  resourceType: "image" | "video" | "raw" = "image",
): Promise<UploadedAsset> {
  return await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
      },
      (error, result) => {
        if (error || !result) {
          return reject(error ?? new Error("UPLOAD_FAILED"));
        }
        const thumbnail =
          resourceType === "image"
            ? cloudinary.url(result.public_id, {
                secure: true,
                transformation: [
                  { width: 480, crop: "limit", quality: "auto", fetch_format: "auto" },
                ],
              })
            : result.secure_url;
        resolve({
          url: result.secure_url,
          thumbnailURL: thumbnail,
          publicId: result.public_id,
          width: result.width || 0,
          height: result.height || 0,
          mimeType: result.format ? `image/${result.format}` : "application/octet-stream",
          bytes: result.bytes || 0,
        });
      },
    );
    stream.end(buffer);
  });
}

export async function uploadImage(
  buffer: Buffer,
  target: UploadTarget,
  uploaderUserID: string,
  filename: string = "",
  isInline: boolean = false,
) {
  const folder =
    target.kind === "artwork" ? "lurelia/event_artwork" : "lurelia/event_media";
  const asset = await uploadToCloudinary(buffer, folder, "image");

  if (target.kind === "artwork") {
    if (target.makePrimary) {
      // Demote existing primaries so the unique partial index doesn't fire.
      await EventArtwork.updateMany(
        { sharedEventID: target.sharedEventID, isPrimary: true },
        { $set: { isPrimary: false } },
      );
    }
    const created = await EventArtwork.create({
      localID: randomUUID(),
      sharedEventID: target.sharedEventID,
      url: asset.url,
      thumbnailURL: asset.thumbnailURL,
      width: asset.width,
      height: asset.height,
      uploaderUserID,
      isPrimary: !!target.makePrimary,
    });
    return created.toObject();
  }

  const attachment = await Attachment.create({
    localID: randomUUID(),
    sharedEventID: target.sharedEventID,
    eventPostID: target.kind === "post" ? target.eventPostID : "",
    announcementID:
      target.kind === "announcement" ? target.announcementID : "",
    kind: "image",
    url: asset.url,
    thumbnailURL: asset.thumbnailURL,
    mimeType: asset.mimeType,
    filename,
    sizeBytes: asset.bytes,
    width: asset.width,
    height: asset.height,
    uploaderUserID,
    isInline,
  });
  return attachment.toObject();
}

export async function uploadFile(
  buffer: Buffer,
  target: UploadTarget,
  uploaderUserID: string,
  filename: string,
  mimeType: string,
) {
  const asset = await uploadToCloudinary(
    buffer,
    "lurelia/event_files",
    "raw",
  );
  const attachment = await Attachment.create({
    localID: randomUUID(),
    sharedEventID:
      target.kind === "artwork"
        ? target.sharedEventID
        : target.sharedEventID,
    eventPostID: target.kind === "post" ? target.eventPostID : "",
    announcementID:
      target.kind === "announcement" ? target.announcementID : "",
    kind: "file",
    url: asset.url,
    mimeType,
    filename,
    sizeBytes: asset.bytes,
    uploaderUserID,
  });
  return attachment.toObject();
}
