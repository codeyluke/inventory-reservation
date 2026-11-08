import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { ProductNotFoundError } from '../domain/errors';
import { Product } from '../domain/product';
import { Reservation } from '../domain/reservation';
import {
  PRODUCT_REPOSITORY,
  type ProductRepository,
} from '../repositories/product.repository';
import {
  RESERVATION_REPOSITORY,
  type ReservationRepository,
} from '../repositories/reservation.repository';
import {
  RESERVATION_CONFIG,
  type ReservationConfig,
} from '../reservation.config';

export interface ReserveCommand {
  productId: string;
  userId: string;
  quantity?: number;
}

@Injectable()
export class ReservationService {
  constructor(
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservations: ReservationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RESERVATION_CONFIG) private readonly config: ReservationConfig,
  ) {}

  async reserve(command: ReserveCommand): Promise<Reservation> {
    const quantity = command.quantity ?? 1;
    const product = await this.loadProduct(command.productId);

    product.reserve(quantity);
    const reservation = Reservation.create({
      id: randomUUID(),
      productId: product.id,
      userId: command.userId,
      quantity,
      now: this.clock.now(),
      holdDurationMs: this.config.holdDurationMs,
    });

    await this.reservations.save(reservation);
    await this.products.save(product);
    return reservation;
  }

  private async loadProduct(productId: string): Promise<Product> {
    const product = await this.products.findById(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }
    return product;
  }
}
