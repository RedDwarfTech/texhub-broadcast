import PQueue from "p-queue";

export interface StoreQueue { 
    queue: PQueue; 
    lastActiveTime: Date;
}