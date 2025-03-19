import { AppControlType } from "../../model/texhub/app/app_control_type";

export interface WsCommand { 
    projectId: string; 
    fileId: string; 
    controlType: AppControlType
}