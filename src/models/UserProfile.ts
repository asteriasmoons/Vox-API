// src/models/UserProfile.ts
import { Schema, Document, Model } from "mongoose";
import { lumeyDB, lunixiaDB, voxTermDB } from "../config/databases";

export interface IUserProfile extends Document {
  userId: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new Schema<IUserProfile>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 30 },
  },
  { timestamps: true },
);

export const LumeyUserProfile: Model<IUserProfile> =
  (lumeyDB.models.UserProfile as Model<IUserProfile>) ||
  lumeyDB.model<IUserProfile>("UserProfile", UserProfileSchema);

export const LunixiaUserProfile: Model<IUserProfile> =
  (lunixiaDB.models.UserProfile as Model<IUserProfile>) ||
  lunixiaDB.model<IUserProfile>("UserProfile", UserProfileSchema);

export const VoxTermUserProfile: Model<IUserProfile> =
  (voxTermDB.models.UserProfile as Model<IUserProfile>) ||
  voxTermDB.model<IUserProfile>("UserProfile", UserProfileSchema);
