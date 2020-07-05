import * as fs from "fs";

export function asyncSleep(timeInSeconds: number): Promise<any> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, timeInSeconds * 1000);
    });
}

export function asyncReadFile(path: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        fs.readFile(path, (err, data) => {
            if (err) reject(err);
            resolve(data);
        });
    });
}

export function asyncWriteFile(path: string, data: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.writeFile(path, data, err => {
            if (err) reject();
            resolve();
        });
    });
}