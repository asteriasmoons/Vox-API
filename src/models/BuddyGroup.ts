// src/models/BuddyGroup.ts

import { lumeyDB } from "../config/databases";
import mongoose, { Schema, Document, Model } from "mongoose";

export type BuddyMemberStatus = "pending" | "joined" | "left";

export interface IBuddyMember {
  userId: string;
  displayName: string;
  status: BuddyMemberStatus;
  isOwner: boolean; // the person who posted the announcement
  joinedAt: Date | null;
  requestedAt: Date;
}

export interface IBuddyGroup extends Document {
  announcementId: string;

  bookTitle: string;
  bookAuthor: string | null;
  bookCoverUrl: string | null;
  bookKey: string | null;

  maxMembers: number;
  members: IBuddyMember[];

  isActive: boolean; // false = all members left or group disbanded
  createdAt: Date;
  updatedAt: Date;
}

const BuddyMemberSchema = new Schema<IBuddyMember>(
  {
    userId: { type: String, required: true },
    displayName: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "joined", "left"],
      default: "pending",
    },
    isOwner: { type: Boolean, default: false },
    joinedAt: { type: Date, default: null },
    requestedAt: { type: Date, required: true },
  },
  { _id: false },
);

const BuddyGroupSchema = new Schema<IBuddyGroup>(
  {
    announcementId: { type: String, required: true, index: true },

    bookTitle: { type: String, required: true },
    bookAuthor: { type: String, default: null },
    bookCoverUrl: { type: String, default: null },
    bookKey: { type: String, default: null },

    maxMembers: { type: Number, default: 2, min: 2, max: 4 },
    members: { type: [BuddyMemberSchema], default: [] },

    isActive: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: true,
  },
);

export const BuddyGroup: Model<IBuddyGroup> =
  lumeyDB.models.BuddyGroup ||
  lumeyDB.model<IBuddyGroup>("BuddyGroup", BuddyGroupSchema, "buddygroups");
