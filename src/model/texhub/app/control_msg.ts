import { AppControlType } from "./app_control_type";

export interface ControlMsg { 
    socketId: string;
    fileId: string;
    controlType: AppControlType;
}