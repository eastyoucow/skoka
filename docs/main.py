import torch
from PIL import Image, ImageDraw
from transformers import Sam3Model, Sam3Processor

model = Sam3Model.from_pretrained("facebook/sam3")
processor = Sam3Processor.from_pretrained("facebook/sam3")

model.eval()

image = Image.open("assets/im1010.jpeg").convert("RGB")

inputs = processor(
    images=image,
    text="person",
    return_tensors="pt"
)

with torch.no_grad():
    outputs = model(**inputs)

results = processor.post_process_instance_segmentation(
    outputs,
    threshold=0.35,
    mask_threshold=0.5,
    target_sizes=inputs["original_sizes"].tolist()
)[0]

print("Found:", len(results["masks"]))


# Создаём копию исходного изображения
result_image = image.copy()

# Полупрозрачный слой для масок
overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))


for mask in results["masks"]:
    # Tensor → PIL Image
    mask_image = Image.fromarray(
        (mask.cpu().numpy() * 255).astype("uint8")
    )

    # Накладываем полупрозрачный красный цвет
    color_layer = Image.new(
        "RGBA",
        image.size,
        (255, 0, 0, 100)
    )

    overlay.paste(
        color_layer,
        (0, 0),
        mask_image
    )


# Накладываем маски на фотографию
result_image = Image.alpha_composite(
    result_image.convert("RGBA"),
    overlay
)


# Рисуем bounding boxes
draw = ImageDraw.Draw(result_image)

for i, box in enumerate(results["boxes"]):
    x1, y1, x2, y2 = box.tolist()

    draw.rectangle(
        (x1, y1, x2, y2),
        outline="red",
        width=4
    )

    draw.text(
        (x1 + 5, y1 + 5),
        str(i + 1),
        fill="red"
    )


# Сохраняем результат
result_image.convert("RGB").save("assets/result.jpeg")

print("Saved to assets/result.jpeg")