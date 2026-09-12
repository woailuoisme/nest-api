import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { firstValueFrom, NEVER, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transformException } from '@/common/upload/multipart/exceptions';
import { cleanupStorageFiles } from '@/common/upload/multipart/file';
import { filterUpload } from '@/common/upload/multipart/filter';
import { accumulateField } from '@/common/upload/multipart/handlers/body-accumulator';
import {
  DiskStorage,
  MemoryStorage,
  type MultipartFile,
  StreamStorage,
  temporaryFileOutput,
} from '@/common/upload/storage';

const createMockMultipartFile = (
  fieldname: string,
  filename: string,
  content: string | Buffer,
  mimetype = 'text/plain',
): MultipartFile => {
  const stream = Readable.from(typeof content === 'string' ? Buffer.from(content) : content);
  return {
    type: 'file' as const,
    fieldname,
    filename,
    encoding: '7bit',
    mimetype,
    file: stream,
    fields: {},
    toBuffer: async () => (typeof content === 'string' ? Buffer.from(content) : content),
  };
};

describe('Upload Storage & Core Utilities', () => {
  const testDir = join(tmpdir(), `nest-forge-storage-test-${Date.now()}`);

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('MemoryStorage', () => {
    it('should buffer file into memory with correct metadata', async () => {
      const storage = new MemoryStorage();
      const mockFile = createMockMultipartFile('file', 'test.txt', 'Hello NestForge!');

      const result = await storage.handleFile(mockFile);

      expect(result.fieldname).toBe('file');
      expect(result.originalFilename).toBe('test.txt');
      expect(result.mimetype).toBe('text/plain');
      expect(result.buffer.toString()).toBe('Hello NestForge!');
      expect(result.size).toBe(Buffer.byteLength('Hello NestForge!'));

      // removeFile should clear buffer
      storage.removeFile(result);
      expect(result.buffer.length).toBe(0);
    });
  });

  describe('DiskStorage', () => {
    it('should write file to disk destination and remove when requested', async () => {
      const storage = new DiskStorage({
        dest: testDir,
        removeAfter: true,
      });

      const mockFile = createMockMultipartFile('doc', 'invoice.pdf', 'PDF-DATA-CONTENT', 'application/pdf');
      const result = await storage.handleFile(mockFile, {} as any);

      expect(result.path).toBeDefined();
      expect(result.dest).toBe(testDir);
      expect(result.size).toBe(Buffer.byteLength('PDF-DATA-CONTENT'));

      // Verify file exists on disk
      const diskContent = await fs.readFile(result.path, 'utf-8');
      expect(diskContent).toBe('PDF-DATA-CONTENT');

      // Verify removeFile removes it when removeAfter is true
      await storage.removeFile(result);
      await expect(fs.access(result.path)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('should support custom filename and dest functions', async () => {
      const storage = new DiskStorage({
        dest: () => testDir,
        filename: (file) => `custom-${file.filename}`,
      });

      const mockFile = createMockMultipartFile('avatar', 'photo.jpg', 'IMAGE-DATA', 'image/jpeg');
      const result = await storage.handleFile(mockFile, {} as any);

      expect(result.filename).toBe('custom-photo.jpg');
      expect(result.path).toBe(join(testDir, 'custom-photo.jpg'));

      const fileData = await fs.readFile(result.path, 'utf-8');
      expect(fileData).toBe('IMAGE-DATA');
    });
  });

  describe('StreamStorage', () => {
    it('should stream to temporary file and provide readable stream', async () => {
      const storage = new StreamStorage();
      const mockFile = createMockMultipartFile('streamFile', 'data.csv', 'id,name\n1,Alice\n2,Bob');

      const result = await storage.handleFile(mockFile);

      expect(result.stream).toBeDefined();
      expect(result.originalFilename).toBe('data.csv');

      // Read from result.stream
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const streamContent = Buffer.concat(chunks).toString('utf-8');
      expect(streamContent).toBe('id,name\n1,Alice\n2,Bob');

      // Remove the file
      await storage.removeFile(result);
    });

    it('temporaryFileOutput should prevent path traversal attacks', () => {
      expect(() => temporaryFileOutput('/etc/passwd')).toThrow('Invalid file path');
      const safePath = temporaryFileOutput('clean-file.png');
      expect(safePath.startsWith(tmpdir())).toBe(true);
    });

    it('should accurately calculate size via bytesWritten and use unique tempFilePath', async () => {
      const storage = new StreamStorage();
      const content = '1234567890abcdef';
      const mockFile = createMockMultipartFile('testFile', 'dup.txt', content);

      const result = await storage.handleFile(mockFile);
      expect(result.size).toBe(Buffer.byteLength(content));
      expect(result.tempFilePath).toBeDefined();
      expect(result.tempFilePath).not.toBe(temporaryFileOutput('dup.txt'));
      expect(result.tempFilePath).toContain('dup.txt');

      // File should exist initially
      await expect(fs.access(result.tempFilePath!)).resolves.toBeUndefined();

      await storage.removeFile(result, true);
      // File should be removed after cleanup
      await expect(fs.access(result.tempFilePath!)).rejects.toThrow();
    });
  });

  describe('cleanupStorageFiles RxJS Operator', () => {
    it('should not delay or block a successful streaming response', async () => {
      const remove = vi.fn(() => NEVER);

      await expect(firstValueFrom(of('ok-stream-response').pipe(cleanupStorageFiles(remove)))).resolves.toBe(
        'ok-stream-response',
      );
      expect(remove).toHaveBeenCalledWith();
    });

    it('should force and await cleanup before propagating handler error', async () => {
      const handlerError = new Error('Database transaction aborted');
      const cleanupSubject = new Subject<void>();
      const remove = vi.fn((force?: boolean) => {
        expect(force).toBe(true);
        return cleanupSubject;
      });

      let errorPropagated = false;
      const pipeline = firstValueFrom(throwError(() => handlerError).pipe(cleanupStorageFiles(remove))).catch((err) => {
        errorPropagated = true;
        throw err;
      });

      await Promise.resolve();
      expect(errorPropagated).toBe(false);
      expect(remove).toHaveBeenCalledTimes(1);

      cleanupSubject.complete();
      await expect(pipeline).rejects.toBe(handlerError);
    });

    it('should preserve original handler error even if cleanup fails', async () => {
      const handlerError = new Error('Handler crashed');
      const cleanupError = new Error('Disk unlink permission denied');
      const remove = vi.fn(() => throwError(() => cleanupError));

      await expect(firstValueFrom(throwError(() => handlerError).pipe(cleanupStorageFiles(remove)))).rejects.toBe(
        handlerError,
      );
      expect(remove).toHaveBeenCalledWith(true);
    });
  });

  describe('transformException', () => {
    it('should transform Fastify 413 / FST_REQ_FILE_TOO_LARGE to PayloadTooLargeException', () => {
      const fastifyError: any = new Error('request file too large');
      fastifyError.code = 'FST_REQ_FILE_TOO_LARGE';

      const transformed = transformException(fastifyError);
      expect(transformed).toBeInstanceOf(PayloadTooLargeException);
    });

    it('should transform Fastify 400 codes to BadRequestException', () => {
      const fastifyError: any = new Error('Multipart protocol error');
      fastifyError.code = 'FST_PROTO_VIOLATION';

      const transformed = transformException(fastifyError);
      expect(transformed).toBeInstanceOf(BadRequestException);
    });

    it('should return original error if not matching fastify codes', () => {
      const customError = new Error('Custom domain error');
      expect(transformException(customError)).toBe(customError);
    });
  });

  describe('filterUpload', () => {
    it('should allow file when filter returns true', async () => {
      const mockStorage = new MemoryStorage();
      const mockFile = await mockStorage.handleFile(
        createMockMultipartFile('image', 'test.png', 'fake-image-bytes', 'image/png'),
      );
      const filter = vi.fn().mockResolvedValue(true);

      const isAllowed = await filterUpload({ filter, storage: mockStorage }, {} as any, mockFile);
      expect(isAllowed).toBe(true);
      expect(filter).toHaveBeenCalled();
    });

    it('should return false and remove file when filter returns false', async () => {
      const mockStorage = new MemoryStorage();
      const removeSpy = vi.spyOn(mockStorage, 'removeFile');
      const mockFile = await mockStorage.handleFile(
        createMockMultipartFile('script', 'malicious.sh', '#!/bin/sh', 'application/x-sh'),
      );
      const filter = vi.fn().mockResolvedValue(false);

      const isAllowed = await filterUpload({ filter, storage: mockStorage }, {} as any, mockFile);
      expect(isAllowed).toBe(false);
      expect(filter).toHaveBeenCalled();
      expect(removeSpy).toHaveBeenCalledWith(mockFile, true);
    });

    it('should throw BadRequestException and remove file when filter returns a string message', async () => {
      const mockStorage = new MemoryStorage();
      const removeSpy = vi.spyOn(mockStorage, 'removeFile');
      const mockFile = await mockStorage.handleFile(
        createMockMultipartFile('doc', 'virus.exe', 'exe-binary', 'application/x-msdownload'),
      );
      const filter = vi.fn().mockResolvedValue('EXE files are not allowed');

      await expect(filterUpload({ filter, storage: mockStorage }, {} as any, mockFile)).rejects.toThrow(
        BadRequestException,
      );
      expect(removeSpy).toHaveBeenCalledWith(mockFile, true);
    });
  });

  describe('accumulateField', () => {
    it('should ignore __proto__, constructor, and prototype to prevent prototype pollution', () => {
      const body: Record<string, unknown> = {};
      accumulateField(body, '__proto__', { polluter: 'yes' });
      accumulateField(body, 'constructor', { polluter: 'yes' });
      accumulateField(body, 'prototype', { polluter: 'yes' });

      expect(body).toEqual({});
      expect(({} as any).polluter).toBeUndefined();
    });

    it('should accumulate standard string values and handle arrays', () => {
      const body: Record<string, unknown> = {};
      accumulateField(body, 'title', 'Hello');
      expect(body.title).toBe('Hello');

      accumulateField(body, 'title', 'World');
      expect(body.title).toEqual(['Hello', 'World']);

      accumulateField(body, 'title', 'Again');
      expect(body.title).toEqual(['Hello', 'World', 'Again']);
    });
  });
});
