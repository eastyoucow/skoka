import { Module } from '@nestjs/common';
import { ModalInferenceClient } from './modal.client';

@Module({
  providers: [ModalInferenceClient],
  exports: [ModalInferenceClient],
})
export class ModalModule {}
