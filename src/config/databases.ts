// src/config/databases.ts

import mongoose, { Connection } from "mongoose";

export const authDB: Connection = mongoose.connection.useDb("auth");
export const lumeyDB: Connection = mongoose.connection.useDb("lumey");
export const lunixiaDB: Connection = mongoose.connection.useDb("lunixia");
export const voxTermDB: Connection = mongoose.connection.useDb("voxTerm")
export const asteriumDB: Connection = mongoose.connection.useDb("asterium");

// Add more later as you create them:
// export const lureliaDB = mongoose.connection.useDb("lurelia");
// export const tallyDB = mongoose.connection.useDb("tally");
// export const marklyDB = mongoose.connection.useDb("markly");
// export const nestlyDB = mongoose.connection.useDb("nestly");
