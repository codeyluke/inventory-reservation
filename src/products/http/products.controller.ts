import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ProductService } from '../application/product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductResponse, toProductResponse } from './product.presenter';

@Controller('products')
export class ProductsController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  async create(@Body() dto: CreateProductDto): Promise<ProductResponse> {
    return toProductResponse(await this.productService.create(dto));
  }

  @Get()
  async list(): Promise<ProductResponse[]> {
    return (await this.productService.list()).map(toProductResponse);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductResponse> {
    return toProductResponse(await this.productService.getById(id));
  }
}
