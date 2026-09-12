import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FastifyMultipart from '@fastify/multipart';
import { Body, Controller, Post, StreamableFile, UseInterceptors } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AnyFilesInterceptor,
  DiskStorage,
  type DiskStorageFile,
  FileFieldsInterceptor,
  FileInterceptor,
  FilesInterceptor,
  MemoryStorage,
  type MemoryStorageFile,
  StreamStorage,
  type StreamStorageFile,
  UploadedFile,
  UploadedFiles,
} from '@/common/upload';

// 构造 multipart/form-data 原生 Buffer（纯标准实现，零额外包依赖）
interface MultipartItem {
  name: string;
  filename?: string;
  contentType?: string;
  content: string | Buffer;
}

function buildMultipart(items: MultipartItem[], boundary = `----UploadTestBoundary${Date.now()}`) {
  const chunks: Buffer[] = [];
  for (const item of items) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (item.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${item.name}"; filename="${item.filename}"\r\nContent-Type: ${item.contentType ?? 'application/octet-stream'}\r\n\r\n`,
        ),
      );
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${item.name}"\r\n\r\n`));
    }
    chunks.push(typeof item.content === 'string' ? Buffer.from(item.content) : item.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(chunks),
  };
}

@Controller('upload-test')
class TestUploadController {
  @Post('single')
  @UseInterceptors(FileInterceptor('file', { storage: new MemoryStorage() }))
  uploadSingle(@UploadedFile() file: MemoryStorageFile) {
    return {
      success: !!file,
      filename: file.originalFilename,
      size: file.size,
    };
  }

  @Post('single-with-body')
  @UseInterceptors(FileInterceptor('file', { storage: new MemoryStorage() }))
  uploadSingleWithBody(@UploadedFile() file: MemoryStorageFile, @Body() body: Record<string, unknown>) {
    return {
      success: !!file,
      body,
    };
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 5, { storage: new MemoryStorage() }))
  uploadMultiple(@UploadedFiles() files: MemoryStorageFile[]) {
    return {
      success: !!files?.length,
      fileCount: files.length,
      filenames: files.map((f) => f.originalFilename),
    };
  }

  @Post('multiple-stream-error')
  @UseInterceptors(FilesInterceptor('files', 5, { storage: new StreamStorage() }))
  uploadMultipleStreamError(): never {
    throw new Error('Upload handler aborted intentionally');
  }

  @Post('any')
  @UseInterceptors(AnyFilesInterceptor({ storage: new MemoryStorage() }))
  uploadAny(@UploadedFiles() files: MemoryStorageFile[]) {
    return {
      success: !!files?.length,
      count: files.length,
      fields: files.map((f) => f.fieldname),
    };
  }

  @Post('fields')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'profile' }, { name: 'avatar', maxCount: 5 }], {
      storage: new MemoryStorage(),
    }),
  )
  uploadFields(
    @UploadedFiles()
    files: { profile?: MemoryStorageFile[]; avatar?: MemoryStorageFile[] },
  ) {
    const profileCount = files.profile?.length ?? 0;
    const avatarCount = files.avatar?.length ?? 0;
    return {
      success: profileCount + avatarCount > 0,
      profileCount,
      avatarCount,
    };
  }

  @Post('single-stream')
  @UseInterceptors(FileInterceptor('file', { storage: new StreamStorage() }))
  streamSingle(@UploadedFile() file: StreamStorageFile) {
    return new StreamableFile(file.stream);
  }

  @Post('single-disk')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: new DiskStorage({ removeAfter: true }),
      dest: join(tmpdir(), 'nest-forge-disk-test'),
    }),
  )
  persistSingle(@UploadedFile() file: DiskStorageFile) {
    return {
      success: !!file,
      filepath: file.path,
    };
  }

  @Post('single-limited')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: new MemoryStorage(),
      limits: { fileSize: 10 },
    }),
  )
  uploadSingleLimited(@UploadedFile() file: MemoryStorageFile) {
    return {
      success: !!file,
      size: file.size,
    };
  }

  @Post('single-filtered')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: new MemoryStorage(),
      filter: (_req, file) => file.mimetype === 'image/png',
    }),
  )
  uploadSingleFiltered(@UploadedFile() file?: MemoryStorageFile) {
    return {
      success: !!file,
    };
  }
}

describe('Fastify Upload Full Workflow', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestUploadController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(FastifyMultipart as any);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('should upload a single file to memory', async () => {
    const { body, headers } = buildMultipart([
      {
        name: 'file',
        filename: 'report.txt',
        contentType: 'text/plain',
        content: 'Report text content',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      filename: 'report.txt',
      size: Buffer.byteLength('Report text content'),
    });
  });

  it('should upload a single file with mixed form fields', async () => {
    const { body, headers } = buildMultipart([
      {
        name: 'file',
        filename: 'avatar.png',
        contentType: 'image/png',
        content: 'avatar-bytes',
      },
      {
        name: 'username',
        content: 'alice',
      },
      {
        name: 'role',
        content: 'admin',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-with-body',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      body: {
        username: 'alice',
        role: 'admin',
      },
    });
  });

  it('should handle non-file fields coming BEFORE file field', async () => {
    const { body, headers } = buildMultipart([
      {
        name: 'department',
        content: 'engineering',
      },
      {
        name: 'file',
        filename: 'specs.md',
        contentType: 'text/markdown',
        content: '# Specs',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-with-body',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      body: {
        department: 'engineering',
      },
    });
  });

  it('should accumulate duplicate non-file fields into an array', async () => {
    const { body, headers } = buildMultipart([
      {
        name: 'file',
        filename: 'doc.txt',
        content: 'text',
      },
      {
        name: 'tags',
        content: 'typescript',
      },
      {
        name: 'tags',
        content: 'nestjs',
      },
      {
        name: 'tags',
        content: 'fastify',
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-with-body',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().body.tags).toEqual(['typescript', 'nestjs', 'fastify']);
  });

  it('should upload multiple files', async () => {
    const { body, headers } = buildMultipart([
      { name: 'files', filename: '1.txt', content: 'one' },
      { name: 'files', filename: '2.txt', content: 'two' },
      { name: 'files', filename: '3.txt', content: 'three' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/multiple',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      fileCount: 3,
      filenames: ['1.txt', '2.txt', '3.txt'],
    });
  });

  it('should clean up StreamStorage temporary files when controller throws', async () => {
    const filename1 = `cleanup-${Date.now()}-1.txt`;
    const filename2 = `cleanup-${Date.now()}-2.txt`;

    const { body, headers } = buildMultipart([
      { name: 'files', filename: filename1, content: 'temp-content-1' },
      { name: 'files', filename: filename2, content: 'temp-content-2' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/multiple-stream-error',
      headers,
      body,
    });

    expect(res.statusCode).toBe(500);

    // Verify temp files were deleted by cleanupStorageFiles
    await expect(fs.access(join(tmpdir(), filename1))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(join(tmpdir(), filename2))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should upload files with arbitrary fieldnames using AnyFilesInterceptor', async () => {
    const { body, headers } = buildMultipart([
      { name: 'customA', filename: 'a.json', content: '{}' },
      { name: 'customB', filename: 'b.json', content: '[]' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/any',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      count: 2,
      fields: ['customA', 'customB'],
    });
  });

  it('should categorize files into distinct field buckets using FileFieldsInterceptor', async () => {
    const { body, headers } = buildMultipart([
      { name: 'profile', filename: 'profile.jpg', content: 'profile-bytes' },
      { name: 'avatar', filename: 'avatar1.png', content: 'avatar-1' },
      { name: 'avatar', filename: 'avatar2.png', content: 'avatar-2' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/fields',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      success: true,
      profileCount: 1,
      avatarCount: 2,
    });
  });

  it('should stream uploaded file back via StreamStorage and StreamableFile', async () => {
    const testContent = 'STREAMABLE-CONTENT-VERIFICATION-XYZ';
    const { body, headers } = buildMultipart([{ name: 'file', filename: 'stream.txt', content: testContent }]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-stream',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).toBe(testContent);
  });

  it('should persist file to disk and clean up if removeAfter is true', async () => {
    const { body, headers } = buildMultipart([{ name: 'file', filename: 'disk-file.txt', content: 'disk-content' }]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-disk',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.success).toBe(true);
    expect(json.filepath.endsWith('.txt')).toBe(true);

    // removeAfter: true ensures file was deleted on response completion
    await expect(fs.access(json.filepath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should reject multiple files on single file field', async () => {
    const { body, headers } = buildMultipart([
      { name: 'file', filename: '1.txt', content: 'one' },
      { name: 'file', filename: '2.txt', content: 'two' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single',
      headers,
      body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('accepts only one file');
  });

  it('should reject file uploaded to undeclared field name', async () => {
    const { body, headers } = buildMultipart([{ name: 'unexpectedField', filename: '1.txt', content: 'one' }]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single',
      headers,
      body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("doesn't accept file");
  });

  it('should transform Fastify FST_REQ_FILE_TOO_LARGE to 413 PayloadTooLargeException', async () => {
    const { body, headers } = buildMultipart([
      { name: 'file', filename: 'large.txt', content: 'This content is definitely longer than 10 bytes' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-limited',
      headers,
      body,
    });

    expect(res.statusCode).toBe(413);
  });

  it('should return success: false when file filter rejects upload', async () => {
    const { body, headers } = buildMultipart([
      { name: 'file', filename: 'script.sh', contentType: 'application/x-sh', content: '#!/bin/sh' },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/upload-test/single-filtered',
      headers,
      body,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: false });
  });
});
