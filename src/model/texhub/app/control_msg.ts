import { AppControlType } from "./app_control_type.js";

export interface ControlMsg { 
    socketId: string;
    fileId: string;
    controlType: AppControlType;
}