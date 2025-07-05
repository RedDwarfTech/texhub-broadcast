export interface AppResponse<T> { 
    result: T; 
    message?: string;
    code?: number;
}