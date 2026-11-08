import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ReservationService } from '../application/reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { IdempotencyKey } from './idempotency-key.decorator';
import { ReservationResponse, toReservationResponse } from './presenters';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationService: ReservationService) {}

  /**
   * Requires an `Idempotency-Key` header: a unique value (e.g. a UUID) per
   * purchase attempt. Repeats with the same key (double-clicks, retries)
   * return the original reservation instead of holding more stock.
   */
  @Post()
  async reserve(
    @Body() dto: CreateReservationDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<ReservationResponse> {
    return toReservationResponse(
      await this.reservationService.reserve({ ...dto, idempotencyKey }),
    );
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReservationResponse> {
    return toReservationResponse(await this.reservationService.getById(id));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReservationResponse> {
    return toReservationResponse(await this.reservationService.confirm(id));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReservationResponse> {
    return toReservationResponse(await this.reservationService.cancel(id));
  }
}
