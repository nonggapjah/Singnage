export interface User {
    username: string;
    fullName: string;
    role: string;
}

export interface LoginResponse {
    token: string;
    username: string;
    fullName: string;
    role: string;
    identifierType?: string; // e.g. 'email', 'phone', 'username'
}
