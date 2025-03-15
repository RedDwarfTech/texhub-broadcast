import { IncomingMessage } from "http";

export interface EngineConnErr { 
    code: number; 
    context: any;
    message: string;
    req: IncomingMessage
}