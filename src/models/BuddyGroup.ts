// src/models/BuddyGroup.ts

import { lumeyDB } from "../config/databases";
import mongoose, { Schema, Document, Model } from "mongoose";

export type BuddyMemberStatus = "pending" | "joined" | "left";

export interface IBuddyMember {
  userId: string;
  displayName: string;
  status: BuddyMemberStatus;
  joinedAt: Date | null;
  requestedAt: Date;
}

export interface IBuddyGroup extends Document {
  announcementId: string;

  // Snapshot of who posted the announcement, copied at creation and never
  // reassigned. Display only — it grants no permissions. Membership decides
  // who can act, so this cannot drift into an authority the way the old
  // per-member isOwner flag did.
  ownerUserId: string | null;
  ownerDisplayName: string | null;

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
    joinedAt: { type: Date, default: null },
    requestedAt: { type: Date, required: true },
  },
  { _id: false },
);

const BuddyGroupSchema = new Schema<IBuddyGroup>(
  {
    announcementId: { type: String, required: true, index: true },

    ownerUserId: { type: String, default: null, index: true },
    ownerDisplayName: { type: String, default: null },

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
