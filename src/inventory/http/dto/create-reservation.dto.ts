import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  productId!: string;

  /**
   * Stand-in for the authenticated user. In production this would come from
   * the auth context (e.g. a JWT subject), not the request body.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}
