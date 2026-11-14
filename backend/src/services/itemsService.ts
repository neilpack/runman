// Example data service. Uses DynamoDB when ITEMS_TABLE is set, otherwise an
// in-memory store so anyone can run the backend locally without AWS access.
// Copy this pattern for new resources.

import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { CreateItemRequest, Item } from '@runman/shared';
import { dynamo } from '../aws/clients.js';
import { config } from '../config.js';

export interface ItemsStore {
  list(): Promise<Item[]>;
  get(id: string): Promise<Item | undefined>;
  create(input: CreateItemRequest): Promise<Item>;
  remove(id: string): Promise<void>;
}

class DynamoItemsStore implements ItemsStore {
  constructor(private readonly table: string) {}

  async list() {
    const res = await dynamo.send(new ScanCommand({ TableName: this.table }));
    return (res.Items ?? []) as Item[];
  }

  async get(id: string) {
    const res = await dynamo.send(new GetCommand({ TableName: this.table, Key: { id } }));
    return res.Item as Item | undefined;
  }

  async create(input: CreateItemRequest) {
    const item: Item = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
    await dynamo.send(new PutCommand({ TableName: this.table, Item: item }));
    return item;
  }

  async remove(id: string) {
    await dynamo.send(new DeleteCommand({ TableName: this.table, Key: { id } }));
  }
}

class MemoryItemsStore implements ItemsStore {
  private items = new Map<string, Item>();

  async list() {
    return [...this.items.values()];
  }

  async get(id: string) {
    return this.items.get(id);
  }

  async create(input: CreateItemRequest) {
    const item: Item = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
    this.items.set(item.id, item);
    return item;
  }

  async remove(id: string) {
    this.items.delete(id);
  }
}

export const storageMode = config.aws.itemsTable ? 'dynamodb' : 'memory';

export const itemsStore: ItemsStore = config.aws.itemsTable
  ? new DynamoItemsStore(config.aws.itemsTable)
  : new MemoryItemsStore();
