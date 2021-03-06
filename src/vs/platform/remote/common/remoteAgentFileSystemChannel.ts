/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { FileChangeType, FileDeleteOptions, FileOverwriteOptions, FileSystemProviderCapabilities, FileType, FileWriteOptions, IFileChange, IFileSystemProvider, IStat, IWatchOptions } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { OperatingSystem } from 'vs/base/common/platform';

export const REMOTE_FILE_SYSTEM_CHANNEL_NAME = 'remotefilesystem';

export interface IFileChangeDto {
	resource: UriComponents;
	type: FileChangeType;
}

export class RemoteExtensionsFileSystemProvider extends Disposable implements IFileSystemProvider {

	private readonly session: string = generateUuid();

	private readonly _onDidChange = this._register(new Emitter<IFileChange[]>());
	readonly onDidChangeFile: Event<IFileChange[]> = this._onDidChange.event;

	private readonly _onDidChangeCapabilities = this._register(new Emitter<void>());
	readonly onDidChangeCapabilities: Event<void> = this._onDidChangeCapabilities.event;

	private _capabilities: FileSystemProviderCapabilities;
	get capabilities(): FileSystemProviderCapabilities { return this._capabilities; }

	constructor(private readonly channel: IChannel, environment: Promise<IRemoteAgentEnvironment | null>) {
		super();

		this.setCaseSensitive(true);
		environment.then(remoteAgentEnvironment => this.setCaseSensitive(!!(remoteAgentEnvironment && remoteAgentEnvironment.os === OperatingSystem.Linux)));

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.channel.listen<IFileChangeDto[]>('filechange', [this.session])((events) => {
			this._onDidChange.fire(events.map(event => ({ resource: URI.revive(event.resource), type: event.type })));
		}));
	}

	setCaseSensitive(isCaseSensitive: boolean) {
		let capabilities = (
			FileSystemProviderCapabilities.FileReadWrite
			| FileSystemProviderCapabilities.FileFolderCopy
		);

		if (isCaseSensitive) {
			capabilities |= FileSystemProviderCapabilities.PathCaseSensitive;
		}

		this._capabilities = capabilities;
		this._onDidChangeCapabilities.fire(undefined);
	}

	// --- forwarding calls

	stat(resource: URI): Promise<IStat> {
		return this.channel.call('stat', [resource]);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const buff = <VSBuffer>await this.channel.call('readFile', [resource]);

		return buff.buffer;
	}

	writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		return this.channel.call('writeFile', [resource, VSBuffer.wrap(content), opts]);
	}

	delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		return this.channel.call('delete', [resource, opts]);
	}

	mkdir(resource: URI): Promise<void> {
		return this.channel.call('mkdir', [resource]);
	}

	readdir(resource: URI): Promise<[string, FileType][]> {
		return this.channel.call('readdir', [resource]);
	}

	rename(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
		return this.channel.call('rename', [resource, target, opts]);
	}

	copy(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
		return this.channel.call('copy', [resource, target, opts]);
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		const req = Math.random();
		this.channel.call('watch', [this.session, req, resource, opts]);

		return toDisposable(() => this.channel.call('unwatch', [this.session, req]));
	}
}
